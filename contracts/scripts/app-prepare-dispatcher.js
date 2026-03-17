import {
  XCM_PRECOMPILE,
  createClients,
  createSubstrateApi,
  readArtifact,
  readDeployment,
  sendNative
} from "./common.js";

import { blake2AsU8a } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import { getAddress, getContract, getContractAddress, parseEther } from "viem";

function evmToSubstrateAccount(address) {
  return u8aToHex(blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256));
}

async function readFreeBalance(api, accountId32) {
  const account = await api.query.system.account(accountId32);
  return BigInt(account.data.free.toString());
}

function getXcmPrecompile(publicClient, walletClient, address) {
  return getContract({
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
    return { balance: current, txHash: null };
  }

  const transferAmount = topUpBalance - current;
  const feeAmount = BigInt(process.env.XCM_LOCAL_FUND_EXECUTION_FEE ?? "1000000000");
  const message = hubApi.createType(
    "XcmVersionedXcm",
    buildLocalFundMessage(beneficiaryAccountId32, transferAmount, feeAmount)
  ).toHex();
  const weight = await xcmPrecompile.read.weighMessage([message]);
  const txHash = await xcmPrecompile.write.execute([message, weight], { account: owner.account });
  console.log(`dispatcherDerivedFundTx ${txHash}`);
  await owner.publicClient.waitForTransactionReceipt({ hash: txHash });
  return { balance: await readFreeBalance(hubApi, beneficiaryAccountId32), txHash };
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

function isAlreadyImportedError(error) {
  const message = `${error?.shortMessage ?? ""}\n${error?.details ?? ""}\n${error?.message ?? ""}`.toLowerCase();
  return (
    message.includes("transaction already imported") ||
    message.includes("nonce provided for the transaction is lower") ||
    message.includes("priority is too low") ||
    message.includes("replacement transaction underpriced")
  );
}

async function waitForContractCode(publicClient, address, attempts = 18, delayMs = 5000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = await publicClient.getCode({ address });
    if (code && code !== "0x") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function main() {
  const walletAddressInput = process.env.WALLET_ADDRESS;
  if (!walletAddressInput) {
    throw new Error("Set WALLET_ADDRESS");
  }

  const walletAddress = getAddress(walletAddressInput);
  const deployment = await readDeployment("polkadotTestnet");
  const operator = createClients("polkadotTestnet");
  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const shouldFundDerived = process.env.FUND_DISPATCHER_DERIVED === "true";

  let dispatcherAddress = process.env.DISPATCHER_ADDRESS ? getAddress(process.env.DISPATCHER_ADDRESS) : null;
  if (!dispatcherAddress) {
    const deployNonce = await operator.publicClient.getTransactionCount({
      address: operator.account.address,
      blockTag: "pending"
    });
    const predictedDispatcherAddress = getContractAddress({
      from: operator.account.address,
      nonce: BigInt(deployNonce)
    });

    try {
      const txHash = await operator.walletClient.deployContract({
        abi: dispatcherArtifact.abi,
        bytecode: dispatcherArtifact.bytecode,
        args: [walletAddress, deployment.contracts.xcmPrecompile],
        nonce: deployNonce
      });
      console.log(`dispatcherDeployTx ${txHash}`);
      const receipt = await operator.publicClient.waitForTransactionReceipt({ hash: txHash });
      dispatcherAddress = getAddress(receipt.contractAddress);
    } catch (error) {
      if (!isAlreadyImportedError(error)) {
        throw error;
      }
      const deployed = await waitForContractCode(operator.publicClient, predictedDispatcherAddress);
      if (!deployed) {
        throw error;
      }
      dispatcherAddress = predictedDispatcherAddress;
      console.log("dispatcherDeployTx reused-pending");
    }
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

  console.log(`walletAddress ${walletAddress}`);
  console.log(`dispatcherAddress ${dispatcherAddress}`);
  console.log(`walletBalance ${walletBalance.toString()}`);
  console.log(`dispatcherBalance ${dispatcherBalance.toString()}`);

  if (shouldFundDerived) {
    const hubApi = await createSubstrateApi("polkadotTestnet");
    const xcmPrecompile = getXcmPrecompile(operator.publicClient, operator.walletClient, deployment.contracts.xcmPrecompile ?? XCM_PRECOMPILE);
    const dispatcherDerivedAccountId32 = evmToSubstrateAccount(dispatcherAddress);
    const funded = await fundDerivedAccountIfNeeded({
      owner: operator,
      hubApi,
      xcmPrecompile,
      beneficiaryAccountId32: dispatcherDerivedAccountId32,
      minBalance: BigInt(process.env.INTEGRATION_DISPATCHER_DERIVED_MIN_BALANCE ?? "12000000000"),
      topUpBalance: BigInt(process.env.INTEGRATION_DISPATCHER_DERIVED_TOP_UP ?? "20000000000")
    });
    console.log(`dispatcherDerivedAccountId32 ${dispatcherDerivedAccountId32}`);
    console.log(`dispatcherDerivedBalance ${funded.balance.toString()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
