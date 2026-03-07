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

import { blake2AsU8a, encodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getContract as viemGetContract,
  http,
  keccak256,
  parseEther,
  publicActions,
  stringToHex,
  toHex,
  zeroHash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PAS_ASSET_ID = keccak256(stringToHex("polkadot-hub/pas-native"));
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BASE_MODE = zeroHash;

const OPERATION_KIND_XCM_PROGRAM = 1;
const ENDPOINT_KIND_EXECUTE = 0;
const XCM_INSTRUCTION_WITHDRAW_ASSET = 0;
const XCM_INSTRUCTION_PAY_FEES = 2;
const XCM_INSTRUCTION_INITIATE_TRANSFER = 3;
const XCM_INSTRUCTION_DEPOSIT_ASSET = 4;

function evmToSubstrateAccount(address) {
  return u8aToHex(blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256));
}

function createSessionClients() {
  const fallbackKey = keccak256(stringToHex("tofu.integration.session"));
  const sessionPrivateKey = process.env.SESSION_PRIVATE_KEY ?? fallbackKey;
  const key = sessionPrivateKey.startsWith("0x") ? sessionPrivateKey : `0x${sessionPrivateKey}`;
  const account = privateKeyToAccount(key);
  const chain = {
    id: NETWORKS.polkadotTestnet.chainId,
    name: NETWORKS.polkadotTestnet.label,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [NETWORKS.polkadotTestnet.rpcUrl] } }
  };
  const transport = http(NETWORKS.polkadotTestnet.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport }).extend(publicActions);

  return { account, publicClient, walletClient, ephemeral: !process.env.SESSION_PRIVATE_KEY };
}

function createIntegrationOwnerClients() {
  const fallbackKey = keccak256(stringToHex(`tofu.integration.owner:${Date.now()}`));
  const ownerPrivateKey = process.env.INTEGRATION_OWNER_PRIVATE_KEY ?? fallbackKey;
  const key = ownerPrivateKey.startsWith("0x") ? ownerPrivateKey : `0x${ownerPrivateKey}`;
  const account = privateKeyToAccount(key);
  const chain = {
    id: NETWORKS.polkadotTestnet.chainId,
    name: NETWORKS.polkadotTestnet.label,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [NETWORKS.polkadotTestnet.rpcUrl] } }
  };
  const transport = http(NETWORKS.polkadotTestnet.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport }).extend(publicActions);

  return { account, publicClient, walletClient, ephemeral: !process.env.INTEGRATION_OWNER_PRIVATE_KEY };
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
  console.log(`evmTopUp recipient=${recipient} tx=${receipt.transactionHash}`);
  return sender.publicClient.getBalance({ address: recipient });
}

function sessionInitData({
  sessionAccount,
  allowedTarget,
  expiresAt,
  chainId,
  beneficiaryAccountId32,
  maxAmount,
  paraId
}) {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
          { type: "bytes4" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "bool" },
          { type: "uint8" },
          { type: "uint8[]" },
          { type: "uint8[]" },
          { type: "uint32[]" },
          { type: "bytes32[]" },
          {
            type: "tuple[]",
            components: [{ type: "bytes32" }, { type: "uint128" }]
          }
        ]
      }
    ],
    [[
      sessionAccount.address,
      stringToHex("agent.execute", { size: 32 }),
      chainId,
      allowedTarget,
      "0x9d998c8f",
      BigInt(expiresAt),
      0n,
      1,
      maxAmount,
      false,
      OPERATION_KIND_XCM_PROGRAM,
      [ENDPOINT_KIND_EXECUTE],
      [
        XCM_INSTRUCTION_WITHDRAW_ASSET,
        XCM_INSTRUCTION_PAY_FEES,
        XCM_INSTRUCTION_INITIATE_TRANSFER,
        XCM_INSTRUCTION_DEPOSIT_ASSET
      ],
      [paraId],
      [beneficiaryAccountId32],
      [[PAS_ASSET_ID, maxAmount]]
    ]]
  );
}

function encodeSingleExecution(target, value, callData) {
  return `${target.toLowerCase()}${toHex(value, { size: 32 }).slice(2)}${callData.slice(2)}`;
}

function encodeProgramExecution(dispatcher, requestId, program) {
  return encodeSingleExecution(
    dispatcher.address,
    0n,
    encodeFunctionData({
      abi: dispatcher.abi,
      functionName: "executeProgram",
      args: [requestId, program]
    })
  );
}

async function buildBootstrapUserOp({
  entryPoint,
  walletFactory,
  predictedWalletAddress,
  owner,
  validator,
  dispatcherAddress,
  sessionAccount,
  beneficiaryAccountId32,
  maxAmount,
  paraId
}) {
  const chainId = BigInt(NETWORKS.polkadotTestnet.chainId);
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const initData = sessionInitData({
    sessionAccount,
    allowedTarget: dispatcherAddress,
    expiresAt,
    chainId,
    beneficiaryAccountId32,
    maxAmount,
    paraId
  });

  const initCode = `${walletFactory.address.toLowerCase()}${encodeFunctionData({
    abi: walletFactory.abi,
    functionName: "createWallet",
    args: [owner.account.address]
  }).slice(2)}`;

  const callData = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "bootstrapInstallModule",
        stateMutability: "nonpayable",
        inputs: [
          { name: "moduleTypeId", type: "uint256" },
          { name: "module", type: "address" },
          { name: "initData", type: "bytes" }
        ],
        outputs: []
      }
    ],
    functionName: "bootstrapInstallModule",
    args: [1n, validator.address, initData]
  });

  const userOp = {
    sender: predictedWalletAddress,
    nonce: 0n,
    initCode,
    callData,
    accountGasLimits: zeroHash,
    preVerificationGas: 0n,
    gasFees: zeroHash,
    paymasterAndData: "0x",
    signature: "0x"
  };

  const userOpHash = await entryPoint.read.getUserOpHash([userOp]);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [userOpHash, predictedWalletAddress, chainId]
    )
  );
  const ownerSignature = await owner.walletClient.signMessage({ account: owner.account, message: { raw: payloadHash } });
  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [ZERO_ADDRESS, ownerSignature]
  );

  return { userOp, userOpHash };
}

async function buildSessionUserOp({
  entryPoint,
  wallet,
  validator,
  session,
  executionCalldata
}) {
  const callData = encodeFunctionData({
    abi: wallet.abi,
    functionName: "execute",
    args: [BASE_MODE, executionCalldata]
  });

  const sessionState = await validator.read.getSessionState([wallet.address]);
  const replayNonce = sessionState[0];

  const userOp = {
    sender: wallet.address,
    nonce: 1n,
    initCode: "0x",
    callData,
    accountGasLimits: zeroHash,
    preVerificationGas: 0n,
    gasFees: zeroHash,
    paymasterAndData: "0x",
    signature: "0x"
  };

  const userOpHash = await entryPoint.read.getUserOpHash([userOp]);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [userOpHash, stringToHex("agent.execute", { size: 32 }), BigInt(NETWORKS.polkadotTestnet.chainId), replayNonce]
    )
  );
  const sessionSignature = await session.walletClient.signMessage({
    account: session.account,
    message: { raw: payloadHash }
  });

  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [
      validator.address,
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [session.account.address, sessionSignature])
    ]
  );

  return { userOp, userOpHash };
}

async function waitForDestinationIncrease(api, beneficiary, beforeBalance) {
  const attempts = Number.parseInt(process.env.XCM_DESTINATION_POLL_ATTEMPTS ?? "24", 10);
  const delayMs = Number.parseInt(process.env.XCM_DESTINATION_POLL_DELAY_MS ?? "5000", 10);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const current = await readFreeBalance(api, beneficiary);
    console.log(`destinationPoll attempt=${attempt} balance=${current.toString()}`);
    if (current > beforeBalance) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return readFreeBalance(api, beneficiary);
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
  topUpBalance,
  label
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
  console.log(`derivedFund ${label} tx=${hash}`);
  await owner.publicClient.waitForTransactionReceipt({ hash });
  return readFreeBalance(hubApi, beneficiaryAccountId32);
}

async function main() {
  const deployment = await readDeployment("polkadotTestnet");
  const peopleDeployment = await readDeployment("peoplePaseo");

  const operator = createClients("polkadotTestnet");
  const integrationOwner = createIntegrationOwnerClients();
  const session = createSessionClients();
  const hubApi = await createSubstrateApi("polkadotTestnet");
  const peopleApi = await createSubstrateApi("peoplePaseo");

  const walletFactoryArtifact = await readArtifact("WalletFactory.sol", "WalletFactory");
  const entryPointArtifact = await readArtifact("mocks/MockEntryPoint.sol", "MockEntryPoint");
  const validatorArtifact = await readArtifact("SessionKeyValidatorModule.sol", "SessionKeyValidatorModule");
  const walletArtifact = await readArtifact("AgentSmartWallet.sol", "AgentSmartWallet");
  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");

  const walletFactory = await getContract(
    operator.walletClient,
    operator.publicClient,
    walletFactoryArtifact,
    deployment.contracts.walletFactory
  );
  const entryPoint = await getContract(
    operator.walletClient,
    operator.publicClient,
    entryPointArtifact,
    deployment.contracts.entryPoint
  );
  const validator = await getContract(
    operator.walletClient,
    operator.publicClient,
    validatorArtifact,
    deployment.contracts.sessionKeyValidatorModule
  );
  const xcmPrecompile = getXcmPrecompile(
    operator.publicClient,
    operator.walletClient,
    deployment.contracts.xcmPrecompile
  );

  const predictedWalletAddress = await walletFactory.read.predictWallet([integrationOwner.account.address]);
  const dispatcherAddress = await deployFromArtifact(
    operator.walletClient,
    operator.publicClient,
    dispatcherArtifact,
    [predictedWalletAddress, deployment.contracts.xcmPrecompile],
    operator.nonceManager
  );
  const dispatcher = await getContract(
    operator.walletClient,
    operator.publicClient,
    dispatcherArtifact,
    dispatcherAddress
  );

  const beneficiaryAccountId32 = process.env.XCM_TEST_BENEFICIARY
    ?? "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";
  const paraId = Number.parseInt(process.env.PEOPLE_PASEO_PARA_ID ?? `${peopleDeployment.paraId}`, 10);
  const transferAmount = BigInt(process.env.PEOPLE_PASEO_TRANSFER_AMOUNT ?? process.env.XCM_TRANSFER_AMOUNT ?? "10000000000");
  const localFee = BigInt(process.env.PEOPLE_PASEO_LOCAL_FEE_AMOUNT ?? "1000000000");
  const remoteFee = BigInt(process.env.PEOPLE_PASEO_REMOTE_FEE_AMOUNT ?? "1000000000");
  const maxAmount = transferAmount;
  const program = {
    endpointKind: ENDPOINT_KIND_EXECUTE,
    endpointParaId: 0,
    instructions: [
      { kind: XCM_INSTRUCTION_WITHDRAW_ASSET, assetId: PAS_ASSET_ID, amount: transferAmount, paraId: 0, accountId32: ZERO_BYTES32 },
      { kind: XCM_INSTRUCTION_PAY_FEES, assetId: PAS_ASSET_ID, amount: localFee, paraId: 0, accountId32: ZERO_BYTES32 },
      { kind: XCM_INSTRUCTION_INITIATE_TRANSFER, assetId: PAS_ASSET_ID, amount: remoteFee, paraId, accountId32: ZERO_BYTES32 },
      { kind: XCM_INSTRUCTION_DEPOSIT_ASSET, assetId: ZERO_BYTES32, amount: 0n, paraId: 0, accountId32: beneficiaryAccountId32 }
    ]
  };

  const walletDerived = evmToSubstrateAccount(predictedWalletAddress);
  const dispatcherDerived = evmToSubstrateAccount(dispatcherAddress);
  const destinationBefore = await readFreeBalance(peopleApi, beneficiaryAccountId32);

  console.log(`entryPoint ${entryPoint.address}`);
  console.log(`walletFactory ${walletFactory.address}`);
  console.log(`validator ${validator.address}`);
  console.log(`operator ${operator.account.address}`);
  console.log(`integrationOwner ${integrationOwner.account.address}`);
  if (integrationOwner.ephemeral) {
    console.log("integrationOwnerSource ephemeralFallback");
  }
  console.log(`walletPredicted ${predictedWalletAddress}`);
  console.log(`walletDerivedAccountId32 ${walletDerived}`);
  console.log(`walletDerivedSs58 ${encodeAddress(walletDerived, 0)}`);
  console.log(`dispatcher ${dispatcherAddress}`);
  console.log(`dispatcherDerivedAccountId32 ${dispatcherDerived}`);
  console.log(`dispatcherDerivedSs58 ${encodeAddress(dispatcherDerived, 0)}`);
  console.log(`sessionKey ${session.account.address}`);
  console.log(`sessionKeyDerived ${evmToSubstrateAccount(session.account.address)}`);
  if (session.ephemeral) {
    console.log("sessionKeySource ephemeralFallback");
  }
  console.log(`destinationParaId ${paraId}`);
  console.log(`beneficiary ${beneficiaryAccountId32}`);
  console.log(`beneficiarySs58 ${encodeAddress(beneficiaryAccountId32, 0)}`);
  console.log(`destinationBeneficiaryBalanceBefore ${destinationBefore.toString()}`);

  const { userOp: bootstrapUserOp, userOpHash: bootstrapUserOpHash } = await buildBootstrapUserOp({
    entryPoint,
    walletFactory,
    predictedWalletAddress,
    owner: integrationOwner,
    validator,
    dispatcherAddress,
    sessionAccount: session.account,
    beneficiaryAccountId32,
    maxAmount,
    paraId
  });
  const bootstrapHandleOpsTx = await entryPoint.write.handleOps([[bootstrapUserOp]], { account: operator.account });
  console.log(`bootstrapUserOpHash ${bootstrapUserOpHash}`);
  console.log(`bootstrapHandleOpsTx ${bootstrapHandleOpsTx}`);
  await operator.publicClient.waitForTransactionReceipt({ hash: bootstrapHandleOpsTx });

  const wallet = await getContract(operator.walletClient, operator.publicClient, walletArtifact, predictedWalletAddress);
  await ensureEvmBalance(operator, predictedWalletAddress, parseEther(process.env.INTEGRATION_WALLET_EVM_BALANCE ?? "0.05"));
  await ensureEvmBalance(operator, dispatcherAddress, parseEther(process.env.INTEGRATION_DISPATCHER_EVM_BALANCE ?? "1"));

  const dispatcherDerivedBalance = await fundDerivedAccountIfNeeded({
    owner: operator,
    hubApi,
    xcmPrecompile,
    beneficiaryAccountId32: dispatcherDerived,
    minBalance: BigInt(process.env.INTEGRATION_DISPATCHER_DERIVED_MIN_BALANCE ?? "12000000000"),
    topUpBalance: BigInt(process.env.INTEGRATION_DISPATCHER_DERIVED_TOP_UP ?? "20000000000"),
    label: "dispatcherDerived"
  });
  console.log(`dispatcherDerivedFreeBalance ${dispatcherDerivedBalance.toString()}`);

  const requestId = `0x${Date.now().toString(16).padEnd(64, "0")}`;
  const executionCalldata = encodeProgramExecution(dispatcher, requestId, program);
  const { userOp: sessionUserOp, userOpHash: sessionUserOpHash } = await buildSessionUserOp({
    entryPoint,
    wallet,
    validator,
    session,
    executionCalldata
  });
  const sessionHandleOpsTx = await entryPoint.write.handleOps([[sessionUserOp]], { account: operator.account });
  console.log(`sessionSigner ${session.account.address}`);
  console.log(`sessionUserOpHash ${sessionUserOpHash}`);
  console.log(`sessionHandleOpsTx ${sessionHandleOpsTx}`);
  await operator.publicClient.waitForTransactionReceipt({ hash: sessionHandleOpsTx });

  const destinationAfter = await waitForDestinationIncrease(peopleApi, beneficiaryAccountId32, destinationBefore);
  console.log(`destinationBeneficiaryBalanceAfter ${destinationAfter.toString()}`);
  console.log(`destinationBalanceDelta ${(destinationAfter - destinationBefore).toString()}`);
  if (destinationAfter <= destinationBefore) {
    throw new Error("Destination beneficiary balance did not increase.");
  }

  await hubApi.disconnect();
  await peopleApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
