import { randomBytes as nodeRandomBytes } from "node:crypto";

import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  padHex,
  stringToHex,
  toHex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  APP_AGENT_ID,
  BASE_MODE,
  DEFAULT_OWNER_ADDRESS,
  DEFAULT_SESSION_DURATION_SECONDS,
  EXECUTE_PROGRAM_SELECTOR,
  OPERATION_KIND_XCM_PROGRAM,
  PAS_ASSET_ID,
  POLKADOT_HUB_CHAIN_ID,
  SUPPORTED_ROUTES,
  ZERO_ADDRESS,
  ZERO_BYTES32
} from "./constants.js";
import { getContractsConfig, getWalletFactoryContract } from "./contracts.js";
import { prepareWalletDispatcher } from "./dispatcher-runtime.js";
import { getEnv } from "./server-env.js";
import { makeId, readState, writeState } from "./state-store.js";

const ENABLE_CHAIN_READS = process.env.APP_ENABLE_CHAIN_READS !== "false";
const ENABLE_CHAIN_SUBMISSION = process.env.APP_ENABLE_CHAIN_SUBMISSION === "true";

function nowIso() {
  return new Date().toISOString();
}

function resolveOwnerAddress(ownerAddress) {
  const privateKey = getEnv("PRIVATE_KEY");
  const derivedOwner = privateKey ? privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`).address : null;
  const address = ownerAddress ?? derivedOwner ?? DEFAULT_OWNER_ADDRESS;
  if (!isAddress(address)) {
    throw new Error("A valid ownerAddress is required");
  }
  return getAddress(address);
}

function normalizeSessionPublicKey(sessionPublicKey) {
  if (!sessionPublicKey || !isAddress(sessionPublicKey)) {
    throw new Error("sessionPublicKey is required and must be a valid address");
  }
  return getAddress(sessionPublicKey);
}

function getRoute(targetChain) {
  const route = SUPPORTED_ROUTES[targetChain];
  if (!route) {
    throw new Error(`Unsupported targetChain ${targetChain}`);
  }
  return route;
}

function parsePositiveBigInt(value, field) {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`${field} must be a positive integer string`);
  }
}

function normalizeBeneficiary(beneficiary) {
  if (typeof beneficiary !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(beneficiary)) {
    throw new Error("program.beneficiary must be a bytes32 AccountId32 hex string");
  }
  return beneficiary.toLowerCase();
}

function buildProgram(targetChain, program) {
  const route = getRoute(targetChain);
  const transferAmount = parsePositiveBigInt(program?.transferAmount, "program.transferAmount");
  const beneficiary = normalizeBeneficiary(program?.beneficiary);
  const localFee = 1_000_000_000n;
  const remoteFee = 1_000_000_000n;

  return {
    endpointKind: 0,
    endpointParaId: 0,
    instructions: [
      { kind: 0, assetId: PAS_ASSET_ID, amount: transferAmount, paraId: 0, accountId32: ZERO_BYTES32 },
      { kind: 2, assetId: PAS_ASSET_ID, amount: localFee, paraId: 0, accountId32: ZERO_BYTES32 },
      { kind: 3, assetId: PAS_ASSET_ID, amount: remoteFee, paraId: route.paraId, accountId32: ZERO_BYTES32 },
      { kind: 4, assetId: ZERO_BYTES32, amount: 0n, paraId: 0, accountId32: beneficiary }
    ]
  };
}

function validateProgram(program, route) {
  const kinds = program.instructions.map((instruction) => instruction.kind);
  const routeKinds = JSON.stringify(route.allowedInstructionKinds);
  if (JSON.stringify(kinds) !== routeKinds) {
    throw new Error("Only the current typed transfer instruction sequence is supported");
  }

  const transferInstruction = program.instructions[2];
  if (transferInstruction.paraId !== route.paraId) {
    throw new Error("Program destination paraId is not allowlisted");
  }
}

function buildExplanation(summary, route, program) {
  return {
    plainLanguage: `${summary}. This grants the agent one scoped People Chain transfer session from Polkadot Hub Testnet.`,
    sourceChain: route.sourceChainLabel,
    destinationChain: route.label,
    primaryAssetId: PAS_ASSET_ID,
    primaryAmount: program.instructions[0].amount.toString(),
    beneficiary: program.instructions[3].accountId32,
    instructionKinds: route.allowedInstructionKinds,
    paraId: route.paraId,
    endpointKind: program.endpointKind
  };
}

function hydrateProgram(program) {
  return {
    endpointKind: Number(program.endpointKind),
    endpointParaId: Number(program.endpointParaId),
    instructions: program.instructions.map((instruction) => ({
      kind: Number(instruction.kind),
      assetId: instruction.assetId,
      amount: BigInt(instruction.amount),
      paraId: Number(instruction.paraId),
      accountId32: instruction.accountId32
    }))
  };
}

function encodeSingleExecution(target, value, callData) {
  return `${target.toLowerCase()}${padHex(toHex(value), { size: 32 }).slice(2)}${callData.slice(2)}`;
}

function makeRequestId(id) {
  return keccak256(stringToHex(id));
}

function buildSessionInstallData(sessionAccountAddress, dispatcherAddress, beneficiary, maxAmount, paraId, expiresAt) {
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
      sessionAccountAddress,
      stringToHex(APP_AGENT_ID, { size: 32 }),
      POLKADOT_HUB_CHAIN_ID,
      dispatcherAddress,
      EXECUTE_PROGRAM_SELECTOR,
      BigInt(Math.floor(new Date(expiresAt).getTime() / 1000)),
      0n,
      1,
      maxAmount,
      false,
      OPERATION_KIND_XCM_PROGRAM,
      [0],
      [0, 2, 3, 4],
      [paraId],
      [beneficiary],
      [[PAS_ASSET_ID, maxAmount]]
    ]]
  );
}

function buildBootstrapCallData(config, sessionInstallData) {
  return encodeFunctionData({
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
    args: [1n, config.hubDeployment.contracts.sessionKeyValidatorModule, sessionInstallData]
  });
}

function buildInitCode(config, ownerAddress) {
  return `${config.hubDeployment.contracts.walletFactory.toLowerCase()}${encodeFunctionData({
    abi: config.abis.walletFactory,
    functionName: "createWallet",
    args: [ownerAddress]
  }).slice(2)}`;
}

function buildExecutionDraft(config, request, walletAddress, dispatcherAddress) {
  const requestId = makeRequestId(request.id);
  const hydratedProgram = hydrateProgram(request.program);
  const dispatcherCall = encodeFunctionData({
    abi: config.abis.crossChainDispatcher,
    functionName: "executeProgram",
    args: [requestId, hydratedProgram]
  });

  const executionCalldata = encodeSingleExecution(
    dispatcherAddress,
    0n,
    dispatcherCall
  );

  return {
    requestId,
    executionCalldata,
    walletExecuteCallData: encodeFunctionData({
      abi: config.abis.wallet,
      functionName: "execute",
      args: [BASE_MODE, executionCalldata]
    }),
    routeType: "xcm",
    walletAddress
  };
}

async function predictWalletAddress(ownerAddress) {
  if (!ENABLE_CHAIN_READS) {
    return null;
  }

  try {
    const contract = await getWalletFactoryContract();
    return await contract.read.predictWallet([ownerAddress]);
  } catch {
    return null;
  }
}

async function ensureWallet(state, ownerAddress) {
  const normalizedOwner = resolveOwnerAddress(ownerAddress);
  let wallet = state.wallets.find((entry) => entry.ownerAddress === normalizedOwner);

  if (!wallet) {
    const predictedWalletAddress = await predictWalletAddress(normalizedOwner);
    wallet = {
      ownerAddress: normalizedOwner,
      predictedWalletAddress,
      deployedWalletAddress: null,
      dispatcherAddress: null,
      status: predictedWalletAddress ? "predicted" : "unresolved",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.wallets.unshift(wallet);
  } else if (!wallet.predictedWalletAddress) {
    wallet.predictedWalletAddress = await predictWalletAddress(normalizedOwner);
    if (wallet.predictedWalletAddress) {
      wallet.status = wallet.deployedWalletAddress ? wallet.status : "predicted";
    }
    wallet.updatedAt = nowIso();
  }

  return wallet;
}

async function ensureDispatcher(state, wallet, fallbackDispatcherAddress) {
  if (process.env.APP_DISABLE_DISPATCHER_RUNTIME === "true" || !getEnv("PRIVATE_KEY")) {
    wallet.dispatcherAddress = wallet.dispatcherAddress ?? fallbackDispatcherAddress;
    wallet.dispatcherPreparedAt = wallet.dispatcherPreparedAt ?? nowIso();
    wallet.updatedAt = nowIso();
    return { dispatcherAddress: wallet.dispatcherAddress };
  }

  if (!wallet.predictedWalletAddress) {
    throw new Error("Wallet prediction is required before preparing the dispatcher");
  }

  const prepared = await prepareWalletDispatcher(wallet.predictedWalletAddress, wallet.dispatcherAddress);
  wallet.dispatcherAddress = prepared.dispatcherAddress;
  wallet.dispatcherPreparedAt = nowIso();
  wallet.updatedAt = nowIso();
  return prepared;
}

function toSerializable(state) {
  return JSON.parse(
    JSON.stringify(state, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );
}

function sanitizeSession(session) {
  return {
    ...toSerializable(session),
    sessionPrivateKey: undefined
  };
}

export async function createAgentRequest(payload) {
  if (payload?.actionType !== "execute") {
    throw new Error("actionType must be execute");
  }
  if (!payload?.targetChain) {
    throw new Error("targetChain is required");
  }
  if (!payload?.summary) {
    throw new Error("summary is required");
  }

  const route = getRoute(payload.targetChain);
  const program = buildProgram(payload.targetChain, payload.program);
  validateProgram(program, route);

  const state = await readState();
  const request = {
    id: makeId("req"),
    agentId: APP_AGENT_ID,
    userId: resolveOwnerAddress(payload.ownerAddress),
    sessionPublicKey: normalizeSessionPublicKey(payload.sessionPublicKey),
    actionType: "execute",
    status: "pending",
    sourceChain: route.sourceChain,
    sourceChainLabel: route.sourceChainLabel,
    targetChain: route.chainId,
    targetChainLabel: route.label,
    routeType: "xcm",
    program,
    value: payload.value ?? "0",
    summary: payload.summary,
    explanation: buildExplanation(payload.summary, route, program),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  state.requests.unshift(request);
  await writeState(toSerializable(state));
  return toSerializable(request);
}

export async function listRequests() {
  const state = await readState();
  return state.requests;
}

export async function getRequestById(id) {
  const state = await readState();
  const request = state.requests.find((entry) => entry.id === id);
  if (!request) {
    throw new Error("Request not found");
  }
  return request;
}

export async function rejectRequest(id) {
  const state = await readState();
  const request = state.requests.find((entry) => entry.id === id);
  if (!request) {
    throw new Error("Request not found");
  }
  if (request.status !== "pending") {
    throw new Error(`Request is already ${request.status}`);
  }
  request.status = "rejected";
  request.updatedAt = nowIso();
  await writeState(state);
  return request;
}

export async function approveRequest(id, ownerAddress) {
  const state = await readState();
  const request = state.requests.find((entry) => entry.id === id);
  if (!request) {
    throw new Error("Request not found");
  }
  if (request.status !== "pending") {
    throw new Error(`Request is already ${request.status}`);
  }

  const wallet = await ensureWallet(state, ownerAddress ?? request.userId);
  const config = await getContractsConfig();
  const dispatcher = await ensureDispatcher(state, wallet, config.hubDeployment.contracts.crossChainDispatcher);
  const expiresAt = new Date(Date.now() + DEFAULT_SESSION_DURATION_SECONDS * 1000).toISOString();
  const maxAmount = BigInt(request.program.instructions[0].amount);
  const beneficiary = request.program.instructions[3].accountId32;
  const paraId = request.program.instructions[2].paraId;
  const sessionInstallData = buildSessionInstallData(
    request.sessionPublicKey,
    dispatcher.dispatcherAddress,
    beneficiary,
    maxAmount,
    paraId,
    expiresAt
  );
  const walletAddress = wallet.deployedWalletAddress ?? wallet.predictedWalletAddress;

  const session = {
    id: makeId("session"),
    requestId: request.id,
    ownerAddress: wallet.ownerAddress,
    walletAddress,
    walletStatus: wallet.status,
    agentId: APP_AGENT_ID,
    sessionPublicKey: request.sessionPublicKey,
    targetChain: request.targetChain,
    validatorAddress: config.hubDeployment.contracts.sessionKeyValidatorModule,
    allowedTarget: dispatcher.dispatcherAddress,
    allowedSelector: EXECUTE_PROGRAM_SELECTOR,
    allowedEndpointKinds: [0],
    allowedInstructionKinds: [0, 2, 3, 4],
    allowedDestinationParaIds: [paraId],
    allowedBeneficiaries: [beneficiary],
    assetLimits: [{ assetId: PAS_ASSET_ID, maxAmount: maxAmount.toString() }],
    expiresAt,
    status: wallet.status === "deployed" ? "active" : "approved",
    bootstrap: {
      initCode: buildInitCode(config, wallet.ownerAddress),
      callData: buildBootstrapCallData(config, sessionInstallData),
      sessionInstallData
    },
    executionDraft: buildExecutionDraft(config, request, walletAddress, dispatcher.dispatcherAddress),
    approvedAt: nowIso(),
    updatedAt: nowIso()
  };

  request.status = "approved";
  request.sessionId = session.id;
  request.updatedAt = nowIso();
  state.sessions.unshift(session);
  await writeState(toSerializable(state));
  return sanitizeSession(session);
}

export async function listSessions() {
  const state = await readState();
  return state.sessions.map((session) => sanitizeSession(session));
}

export async function getSessionById(id) {
  return getSessionRecord(id);
}

export async function getSessionRecord(id, options = {}) {
  const state = await readState();
  const session = state.sessions.find((entry) => entry.id === id);
  if (!session) {
    throw new Error("Session not found");
  }
  return sanitizeSession(session);
}

export async function listExecutions() {
  const state = await readState();
  return state.executions;
}

export async function getWalletStatus(ownerAddress) {
  const state = await readState();
  const wallet = await ensureWallet(state, ownerAddress);
  await writeState(state);
  return wallet;
}

export async function getWalletRecord(ownerAddress) {
  const state = await readState();
  return ensureWallet(state, ownerAddress);
}

export async function deployWalletForOwner(ownerAddress) {
  const state = await readState();
  const wallet = await ensureWallet(state, ownerAddress);
  wallet.deployedWalletAddress = wallet.predictedWalletAddress ?? wallet.deployedWalletAddress;
  wallet.status = wallet.deployedWalletAddress ? "deployed" : "simulated";
  wallet.updatedAt = nowIso();

  for (const session of state.sessions) {
    if (session.ownerAddress === wallet.ownerAddress && session.status === "approved") {
      session.status = "active";
      session.walletAddress = wallet.deployedWalletAddress ?? session.walletAddress;
      session.walletStatus = wallet.status;
      session.executionDraft.walletAddress = session.walletAddress;
      session.updatedAt = nowIso();
    }
  }

  await writeState(state);
  return wallet;
}

export async function markSessionSubmitted(sessionId, updates) {
  const state = await readState();
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  if (updates.bootstrapTxHash) {
    session.bootstrapTxHash = updates.bootstrapTxHash;
  }
  if (updates.bootstrapUserOpHash) {
    session.bootstrapUserOpHash = updates.bootstrapUserOpHash;
  }
  if (updates.lastUserOpTxHash) {
    session.lastUserOpTxHash = updates.lastUserOpTxHash;
  }
  if (updates.lastUserOpHash) {
    session.lastUserOpHash = updates.lastUserOpHash;
  }
  if (updates.activate) {
    session.status = "active";
  }

  session.updatedAt = nowIso();
  await writeState(state);
  return session;
}

export async function markExecutionSubmitted(executionId, updates) {
  const state = await readState();
  const execution = state.executions.find((entry) => entry.id === executionId);
  if (!execution) {
    throw new Error("Execution not found");
  }

  execution.status = "submitted";
  execution.hubTxHash = updates.hubTxHash ?? execution.hubTxHash;
  execution.userOpHash = updates.userOpHash ?? execution.userOpHash;
  execution.updatedAt = nowIso();
  await writeState(state);
  return execution;
}

export async function executeAgentRequest({ requestId, sessionId }) {
  return executeAgentRequestWithOptions({ requestId, sessionId });
}

export async function executeAgentRequestWithOptions({ requestId, sessionId, resultOverride, statusOverride }) {
  if (!requestId || !sessionId) {
    throw new Error("requestId and sessionId are required");
  }

  const state = await readState();
  const request = state.requests.find((entry) => entry.id === requestId);
  if (!request) {
    throw new Error("Request not found");
  }

  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.requestId !== request.id) {
    throw new Error("sessionId does not belong to requestId");
  }
  if (session.status !== "active") {
    throw new Error("Session is not active");
  }

  const execution = {
    id: makeId("exec"),
    sessionId: session.id,
    requestId: request.id,
    routeType: request.routeType,
    sourceChain: request.sourceChain,
    destinationChain: request.targetChain,
    status: statusOverride ?? (ENABLE_CHAIN_SUBMISSION ? "submitted" : "simulated"),
    hubTxHash: ENABLE_CHAIN_SUBMISSION ? null : `0x${nodeRandomBytes(32).toString("hex")}`,
    remoteTxHash: null,
    result: resultOverride ?? {
      mode: ENABLE_CHAIN_SUBMISSION ? "live-disabled-in-codepath" : "simulation",
      requestId: session.executionDraft.requestId,
      executionCalldata: session.executionDraft.executionCalldata
    },
    createdAt: nowIso()
  };

  request.status = "executed";
  request.updatedAt = nowIso();
  session.updatedAt = nowIso();
  state.executions.unshift(execution);
  await writeState(state);
  return execution;
}

export async function getPortalSnapshot(ownerAddress) {
  const state = await readState();
  const wallet = await ensureWallet(state, ownerAddress);
  await writeState(state);
  return {
    wallet,
    requests: state.requests,
    sessions: state.sessions.map((session) => sanitizeSession(session)),
    executions: state.executions
  };
}
