import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  stringToHex,
  zeroHash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { APP_AGENT_ID, POLKADOT_HUB_CHAIN_ID, ZERO_ADDRESS } from "./constants.js";
import { getContractsConfig } from "./contracts.js";
import { getSessionRecord, getWalletRecord, markExecutionSubmitted, markSessionSubmitted } from "./domain.js";

function requirePrivateKey() {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error("PRIVATE_KEY is required for bundler submission");
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

function createBundlerClients(config) {
  const account = privateKeyToAccount(requirePrivateKey());
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: config.chain, transport });
  const walletClient = createWalletClient({ account, chain: config.chain, transport });
  return { account, publicClient, walletClient };
}

function makeBaseUserOp({ sender, nonce, initCode, callData, paymasterAndData = "0x" }) {
  return {
    sender,
    nonce,
    initCode,
    callData,
    accountGasLimits: zeroHash,
    preVerificationGas: 0n,
    gasFees: zeroHash,
    paymasterAndData,
    signature: "0x"
  };
}

function serializeUserOp(userOp) {
  return JSON.parse(
    JSON.stringify(userOp, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );
}

function hydrateUserOp(userOp) {
  return {
    sender: getAddress(userOp.sender),
    nonce: BigInt(userOp.nonce),
    initCode: userOp.initCode,
    callData: userOp.callData,
    accountGasLimits: userOp.accountGasLimits,
    preVerificationGas: BigInt(userOp.preVerificationGas),
    gasFees: userOp.gasFees,
    paymasterAndData: userOp.paymasterAndData,
    signature: userOp.signature
  };
}

async function getEntryPointContract() {
  const config = await getContractsConfig();
  const clients = createBundlerClients(config);
  return {
    config,
    clients,
    address: config.hubDeployment.contracts.entryPoint,
    abi: config.abis.entryPoint
  };
}

async function readUserOpHash(entryPoint, userOp) {
  return entryPoint.clients.publicClient.readContract({
    address: entryPoint.address,
    abi: entryPoint.abi,
    functionName: "getUserOpHash",
    args: [userOp]
  });
}

async function sendPackedUserOperation(userOp) {
  const entryPoint = await getEntryPointContract();
  const hydrated = hydrateUserOp(userOp);
  const hash = await readUserOpHash(entryPoint, hydrated);
  const txHash = await entryPoint.clients.walletClient.writeContract({
    account: entryPoint.clients.account,
    address: entryPoint.address,
    abi: entryPoint.abi,
    functionName: "handleOps",
    args: [[hydrated]]
  });
  const receipt = await entryPoint.clients.publicClient.waitForTransactionReceipt({ hash: txHash });
  return {
    userOpHash: hash,
    txHash,
    receipt
  };
}

export async function buildBootstrapUserOp(sessionId) {
  const session = await getSessionRecord(sessionId, { includeSecret: true });
  const wallet = await getWalletRecord(session.ownerAddress);
  const bundlerAccount = privateKeyToAccount(requirePrivateKey());

  if (getAddress(session.ownerAddress) !== bundlerAccount.address) {
    throw new Error("PRIVATE_KEY account must match the session owner to sign bootstrap userOps");
  }

  const entryPoint = await getEntryPointContract();
  const sender = session.walletAddress ?? wallet.predictedWalletAddress;
  const userOp = makeBaseUserOp({
    sender,
    nonce: 0n,
    initCode: session.bootstrap.initCode,
    callData: session.bootstrap.callData
  });

  const userOpHash = await readUserOpHash(entryPoint, userOp);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [userOpHash, sender, POLKADOT_HUB_CHAIN_ID]
    )
  );
  const ownerSignature = await entryPoint.clients.walletClient.signMessage({
    account: bundlerAccount,
    message: { raw: payloadHash }
  });

  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [ZERO_ADDRESS, ownerSignature]
  );

  return {
    kind: "bootstrap",
    sessionId,
    userOp: serializeUserOp(userOp),
    userOpHash
  };
}

export async function buildSessionUserOp(sessionId) {
  const session = await getSessionRecord(sessionId, { includeSecret: true });
  if (session.status !== "active") {
    throw new Error("Session must be active before building a session userOp");
  }

  const entryPoint = await getEntryPointContract();
  const sessionAccount = privateKeyToAccount(session.sessionPrivateKey);
  const userOp = makeBaseUserOp({
    sender: session.walletAddress,
    nonce: 1n,
    initCode: "0x",
    callData: session.executionDraft.walletExecuteCallData
  });

  const userOpHash = await readUserOpHash(entryPoint, userOp);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [userOpHash, stringToHex(APP_AGENT_ID, { size: 32 }), POLKADOT_HUB_CHAIN_ID, 0n]
    )
  );
  const sessionSignature = await entryPoint.clients.walletClient.signMessage({
    account: sessionAccount,
    message: { raw: payloadHash }
  });

  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [
      session.validatorAddress,
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [sessionAccount.address, sessionSignature])
    ]
  );

  return {
    kind: "session",
    sessionId,
    userOp: serializeUserOp(userOp),
    userOpHash
  };
}

export async function sendUserOperation(input) {
  const submission = await sendPackedUserOperation(input.userOp ?? input);

  if (input.kind === "bootstrap" && input.sessionId) {
    await markSessionSubmitted(input.sessionId, {
      bootstrapTxHash: submission.txHash,
      bootstrapUserOpHash: submission.userOpHash,
      activate: true
    });
  }

  if (input.kind === "session" && input.sessionId) {
    await markSessionSubmitted(input.sessionId, {
      lastUserOpTxHash: submission.txHash,
      lastUserOpHash: submission.userOpHash
    });
  }

  if (input.executionId) {
    await markExecutionSubmitted(input.executionId, {
      hubTxHash: submission.txHash,
      userOpHash: submission.userOpHash
    });
  }

  return {
    ...submission,
    userOp: input.userOp ?? input
  };
}
