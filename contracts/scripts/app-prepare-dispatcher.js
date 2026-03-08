import {
  NETWORKS,
  createClients,
  createSubstrateApi,
  deployFromArtifact,
  getContract,
  readArtifact,
  readDeployment,
  sendNative
} from "./common.js";

import { blake2AsU8a } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import { createPublicClient, getAddress, getContract as viemGetContract, http, parseEther } from "viem";

function evmToSubstrateAccount(address) {
  return u8aToHex(blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256));
}

function getXcmPrecompile(publicClient, walletClient, address) {
  return viemGetContract({
    address,
    abi: [
      {
        type: "function",
        name: "weighMessage",
        stateMutability: "view",
        inputs: [{ name: "message", type: "bytes" }],
        outputs: [
          {
            name: "weight",
            type: "tuple",
            components: [
              { name: "refTime", type: "uint64" },
              { name: "proofSize", type: "uint64" }
            ]
          }
        ]
      },
      {
        type: "function",
        name: "execute",
        stateMutability: "nonpayable",
        inputs: [
          { name: "message", type: "bytes" },
          {
            name: "weight",
            type: "tuple",
            components: [
              { name: "refTime", type: "uint64" },
              { name: "proofSize", type: "uint64" }
            ]
          }
        ],
        outputs: []
      }
    ],
    client: {
      public: publicClient,
      wallet: walletClient
    }
  });
}

async function readFreeBalance(api, accountId32) {
  const account = await api.query.system.account(accountId32);
  return BigInt(account.data.free.toString());
}

async function ensureEvmBalance(sender, recipient, minBalance) {
  const current = await sender.publicClient.getBalance({ address: recipient });
  if (current >= minBalance) {
    return current;
  }

  const receipt = await sendNative(sender.walletClient, sender.publicClient, undefined, recipient, minBalance - current);
  console.log(`walletTopUpTx ${receipt.transactionHash}`);
  return sender.publicClient.getBalance({ address: recipient });
}

function buildLocalFundMessage(beneficiaryAccountId32, transferAmount, executionFee) {
  return {
    V5: [
      {
        WithdrawAsset: [
          {
            id: { parents: 1, interior: { Here: null } },
            fun: { Fungible: transferAmount }
          }
        ]
      },
      {
        BuyExecution: {
          fees: {
            id: { parents: 1, interior: { Here: null } },
            fun: { Fungible: executionFee }
          },
          weight_limit: { Unlimited: null }
        }
      },
      {
        DepositAsset: {
          assets: { Wild: { AllCounted: 1 } },
          beneficiary: {
            parents: 0,
            interior: {
              X1: [
                {
                  AccountId32: {
                    network: null,
                    id: beneficiaryAccountId32
                  }
                }
              ]
            }
          }
        }
      }
    ]
  };
}

async function fundDerivedAccountIfNeeded({
  owner,
  hubApi,
  xcmPrecompile,
  beneficiaryAccountId32,
  minBalance,
  topUpBalance
}) {
  const current = await readFreeBalance(hubApi, beneficiaryAccountId32);
  if (current >= minBalance) {
    return current;
  }

  const transferAmount = topUpBalance - current;
  const feeAmount = BigInt(process.env.XCM_LOCAL_FUND_EXECUTION_FEE ?? "1000000000");
  const message = hubApi.createType("XcmVersionedXcm", buildLocalFundMessage(beneficiaryAccountId32, transferAmount, feeAmount)).toHex();
  const weight = await xcmPrecompile.read.weighMessage([message]);
  const hash = await xcmPrecompile.write.execute([message, weight], { account: owner.account });
  console.log(`dispatcherDerivedFundTx ${hash}`);
  await owner.publicClient.waitForTransactionReceipt({ hash });
  return readFreeBalance(hubApi, beneficiaryAccountId32);
}

async function main() {
  const walletAddressInput = process.env.WALLET_ADDRESS;
  if (!walletAddressInput) {
    throw new Error("Set WALLET_ADDRESS");
  }

  const walletAddress = getAddress(walletAddressInput);
  const deployment = await readDeployment("polkadotTestnet");
  const operator = createClients("polkadotTestnet");
  const hubApi = await createSubstrateApi("polkadotTestnet");
  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const xcmPrecompile = getXcmPrecompile(
    operator.publicClient,
    operator.walletClient,
    deployment.contracts.xcmPrecompile
  );

  let dispatcherAddress = process.env.DISPATCHER_ADDRESS ? getAddress(process.env.DISPATCHER_ADDRESS) : null;
  if (!dispatcherAddress) {
    dispatcherAddress = await deployFromArtifact(
      operator.walletClient,
      operator.publicClient,
      dispatcherArtifact,
      [walletAddress, deployment.contracts.xcmPrecompile],
      operator.nonceManager
    );
    console.log(`dispatcherDeployTx pending`);
  }

  const walletBalance = await ensureEvmBalance(
    operator,
    walletAddress,
    parseEther(process.env.INTEGRATION_WALLET_EVM_BALANCE ?? "0.05")
  );
  const dispatcherBalance = await ensureEvmBalance(
    operator,
    dispatcherAddress,
    parseEther(process.env.INTEGRATION_DISPATCHER_EVM_BALANCE ?? "1")
  );

  const dispatcherDerived = evmToSubstrateAccount(dispatcherAddress);
  const dispatcherDerivedBalance = await fundDerivedAccountIfNeeded({
    owner: operator,
    hubApi,
    xcmPrecompile,
    beneficiaryAccountId32: dispatcherDerived,
    minBalance: BigInt(process.env.INTEGRATION_DISPATCHER_DERIVED_MIN_BALANCE ?? "12000000000"),
    topUpBalance: BigInt(process.env.INTEGRATION_DISPATCHER_DERIVED_TOP_UP ?? "20000000000")
  });

  console.log(`walletAddress ${walletAddress}`);
  console.log(`dispatcherAddress ${dispatcherAddress}`);
  console.log(`walletBalance ${walletBalance.toString()}`);
  console.log(`dispatcherBalance ${dispatcherBalance.toString()}`);
  console.log(`dispatcherDerivedAccountId32 ${dispatcherDerived}`);
  console.log(`dispatcherDerivedBalance ${dispatcherDerivedBalance.toString()}`);

  await hubApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
