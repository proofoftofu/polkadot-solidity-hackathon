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
import { getRequiredEnv } from "./server-env.js";
import { getSessionRecord, getWalletRecord, markExecutionSubmitted, markSessionSubmitted } from "./domain.js";

function requirePrivateKey() {
  const key = getRequiredEnv("PRIVATE_KEY");
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

function serializeValue(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner))
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

function logBundler(message, details) {
  if (details === undefined) {
    console.log(`[bundler] ${message}`);
    return;
  }
  console.log(`[bundler] ${message}`, details);
}

function normalizeSignature(signature, field = "signature") {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]*$/.test(signature) || signature.length < 4) {
    throw new Error(`${field} must be a hex string`);
  }
  return signature;
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

async function readSessionReplayNonce(config, clients, walletAddress) {
  const sessionState = await clients.publicClient.readContract({
    address: config.hubDeployment.contracts.sessionKeyValidatorModule,
    abi: config.abis.sessionKeyValidatorModule,
    functionName: "getSessionState",
    args: [walletAddress]
  });
  return sessionState[0];
}

async function readSessionState(config, clients, walletAddress) {
  return clients.publicClient.readContract({
    address: config.hubDeployment.contracts.sessionKeyValidatorModule,
    abi: config.abis.sessionKeyValidatorModule,
    functionName: "getSessionState",
    args: [walletAddress]
  });
}

async function readWalletNonce(config, clients, walletAddress) {
  return clients.publicClient.readContract({
    address: walletAddress,
    abi: config.abis.wallet,
    functionName: "nonce"
  });
}

async function readWalletDeployment(clients, walletAddress) {
  const code = await clients.publicClient.getCode({ address: walletAddress });
  return Boolean(code && code !== "0x");
}

async function sendPackedUserOperation(userOp) {
  const entryPoint = await getEntryPointContract();
  const hydrated = hydrateUserOp(userOp);
  const hash = await readUserOpHash(entryPoint, hydrated);
  logBundler("Submitting handleOps", { sender: hydrated.sender, nonce: hydrated.nonce.toString(), userOpHash: hash });
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
    receipt: serializeValue(receipt)
  };
}

export async function buildBootstrapSigningRequest(sessionId) {
  const session = await getSessionRecord(sessionId);
  const wallet = await getWalletRecord(session.ownerAddress);
  const entryPoint = await getEntryPointContract();
  const sender = session.walletAddress ?? wallet.predictedWalletAddress;
  const deployed = await readWalletDeployment(entryPoint.clients, sender);

  if (session.bootstrap?.mode === "owner-install" || deployed) {
    const walletNonce = deployed ? await readWalletNonce(entryPoint.config, entryPoint.clients, sender) : 0n;
    const userOp = makeBaseUserOp({
      sender,
      nonce: walletNonce,
      initCode: "0x",
      callData: session.bootstrap?.ownerInstallCallData ?? session.bootstrap?.callData
    });
    const userOpHash = await readUserOpHash(entryPoint, userOp);
    const payloadHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [userOpHash, sender, POLKADOT_HUB_CHAIN_ID]
      )
    );
    logBundler("Prepared owner install userOp", {
      sessionId,
      walletAddress: sender,
      ownerAddress: session.ownerAddress,
      walletNonce: walletNonce.toString(),
      userOpHash,
      payloadHash
    });
    return {
      kind: "owner-install",
      sessionId,
      signerAddress: session.ownerAddress,
      signatureField: "ownerSignature",
      userOp: serializeUserOp(userOp),
      userOpHash,
      payloadHash
    };
  }

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

  logBundler("Prepared bootstrap signing request", { sessionId, sender, ownerAddress: session.ownerAddress, userOpHash, payloadHash });
  return {
    kind: "bootstrap",
    sessionId,
    signerAddress: session.ownerAddress,
    signatureField: "ownerSignature",
    userOp: serializeUserOp(userOp),
    userOpHash,
    payloadHash
  };
}

export async function buildBootstrapUserOp(sessionId, ownerSignatureInput) {
  const prepared = await buildBootstrapSigningRequest(sessionId);
  const ownerSignature = normalizeSignature(ownerSignatureInput, "ownerSignature");
  prepared.userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [ZERO_ADDRESS, ownerSignature]
  );
  return prepared;
}

export async function buildSessionSigningRequest(sessionId) {
  const session = await getSessionRecord(sessionId);
  if (session.status !== "active") {
    throw new Error("Session must be active before building a session userOp");
  }

  const entryPoint = await getEntryPointContract();
  const replayNonce = await readSessionReplayNonce(entryPoint.config, entryPoint.clients, session.walletAddress);
  const walletNonce = await readWalletNonce(entryPoint.config, entryPoint.clients, session.walletAddress);
  const userOp = makeBaseUserOp({
    sender: session.walletAddress,
    nonce: walletNonce,
    initCode: "0x",
    callData: session.executionDraft.walletExecuteCallData
  });

  const userOpHash = await readUserOpHash(entryPoint, userOp);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [userOpHash, stringToHex(APP_AGENT_ID, { size: 32 }), POLKADOT_HUB_CHAIN_ID, replayNonce]
    )
  );

  logBundler("Prepared session signing request", {
    sessionId,
    walletAddress: session.walletAddress,
    walletNonce: walletNonce.toString(),
    sessionSigner: session.sessionPublicKey,
    replayNonce: replayNonce.toString(),
    userOpHash,
    payloadHash
  });
  return {
    kind: "session",
    sessionId,
    signerAddress: session.sessionPublicKey,
    signatureField: "sessionSignature",
    replayNonce: replayNonce.toString(),
    userOp: serializeUserOp(userOp),
    userOpHash,
    payloadHash
  };
}

export async function buildSessionUserOp(sessionId, sessionSignatureInput, signerAddressInput) {
  const prepared = await buildSessionSigningRequest(sessionId);
  const signerAddress = getAddress(signerAddressInput ?? prepared.signerAddress);
  if (signerAddress !== getAddress(prepared.signerAddress)) {
    throw new Error("signerAddress does not match the approved sessionPublicKey");
  }
  const sessionSignature = normalizeSignature(sessionSignatureInput, "sessionSignature");
  prepared.userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [
      (await getSessionRecord(sessionId)).validatorAddress,
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [signerAddress, sessionSignature])
    ]
  );
  return prepared;
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
