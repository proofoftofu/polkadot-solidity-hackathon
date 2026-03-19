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
import { getContractsConfig, getReadClient, predictWalletAddressForOwner } from "./contracts.js";
import { prepareWalletDispatcher } from "./dispatcher-runtime.js";
import { getEnv } from "./server-env.js";
import { makeId, readState, writeState } from "./state-store.js";

const ENABLE_CHAIN_READS = true;
const ENABLE_CHAIN_SUBMISSION = true;
const CHAIN_READ_ATTEMPTS = 3;

function nowIso() {
  return new Date().toISOString();
}

function logApprovalStep(step, details) {
  if (details === undefined) {
    console.log(`[domain/approve] ${step}`);
    return;
  }
  console.log(`[domain/approve] ${step}`, details);
}

async function retryChainRead(label, operation, attempts = CHAIN_READ_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[domain/chain-read] ${label} failed`, {
        attempt,
        message: error?.shortMessage ?? error?.message ?? String(error)
      });
    }
  }
  throw lastError;
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

function resolveStateOwner(ownerAddress) {
  return resolveOwnerAddress(ownerAddress);
}

async function readOwnerState(ownerAddress) {
  return readState(resolveStateOwner(ownerAddress));
}

async function writeOwnerState(ownerAddress, state) {
  return writeState(resolveStateOwner(ownerAddress), state);
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
  const tupleValues = [
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
  ];

  console.log("[domain/approve] buildSessionInstallData", {
    sessionAccountAddress,
    dispatcherAddress,
    beneficiary,
    maxAmount: maxAmount.toString(),
    paraId,
    expiresAt,
    tupleFieldCount: tupleValues.length,
    tupleValues: tupleValues.map((value) => (
      typeof value === "bigint" ? value.toString() : value
    ))
  });

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
    [tupleValues]
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

function buildOwnerInstallCallData(config, sessionInstallData) {
  return encodeFunctionData({
    abi: config.abis.wallet,
    functionName: "configureValidator",
    args: [
      config.hubDeployment.contracts.sessionKeyValidatorModule,
      "0x",
      sessionInstallData
    ]
  });
}

function buildOwnerUninstallCallData(config) {
  return encodeFunctionData({
    abi: config.abis.wallet,
    functionName: "uninstallModule",
    args: [1n, config.hubDeployment.contracts.sessionKeyValidatorModule, "0x"]
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
    return await retryChainRead("predictWallet", async () => predictWalletAddressForOwner(ownerAddress));
  } catch (error) {
    console.warn("[domain/chain-read] predictWallet exhausted", {
      ownerAddress,
      message: error?.shortMessage ?? error?.message ?? String(error)
    });
    return null;
  }
}

async function readLiveWalletState(config, walletAddress) {
  if (!ENABLE_CHAIN_READS || !walletAddress) {
    return null;
  }

  try {
    return await retryChainRead("readLiveWalletState", async () => {
      const client = await getReadClient();
      const code = await client.getCode({ address: walletAddress });
      if (!code || code === "0x") {
        return { deployed: false, nonce: 0n, validatorInstalled: false };
      }

      const [nonce, sessionState] = await Promise.all([
        client.readContract({
          address: walletAddress,
          abi: config.abis.wallet,
          functionName: "nonce"
        }),
        client.readContract({
          address: config.hubDeployment.contracts.sessionKeyValidatorModule,
          abi: config.abis.sessionKeyValidatorModule,
          functionName: "getSessionState",
          args: [walletAddress]
        })
      ]);

      return {
        deployed: true,
        nonce,
        validatorInstalled: Boolean(sessionState[4])
      };
    });
  } catch (error) {
    console.warn("[domain/chain-read] readLiveWalletState exhausted", {
      walletAddress,
      message: error?.shortMessage ?? error?.message ?? String(error)
    });
    return null;
  }
}

async function ensureWallet(state, ownerAddress) {
  const normalizedOwner = resolveOwnerAddress(ownerAddress);
  let wallet = state.wallets.find((entry) => entry.ownerAddress === normalizedOwner);
  const config = await getContractsConfig();

  if (!wallet) {
    const predictedWalletAddress = await predictWalletAddress(normalizedOwner);
    const liveState = await readLiveWalletState(config, predictedWalletAddress);
    wallet = {
      ownerAddress: normalizedOwner,
      predictedWalletAddress,
      deployedWalletAddress: liveState?.deployed ? predictedWalletAddress : null,
      dispatcherAddress: null,
      status: liveState?.deployed ? "deployed" : (predictedWalletAddress ? "predicted" : "unresolved"),
      liveNonce: liveState?.nonce?.toString?.() ?? "0",
      validatorInstalled: liveState?.validatorInstalled ?? false,
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

  if (wallet.predictedWalletAddress) {
    const liveState = await readLiveWalletState(config, wallet.predictedWalletAddress);
    if (liveState?.deployed) {
      wallet.deployedWalletAddress = wallet.predictedWalletAddress;
      wallet.status = "deployed";
      wallet.liveNonce = liveState.nonce.toString();
      wallet.validatorInstalled = liveState.validatorInstalled;
      wallet.updatedAt = nowIso();
    } else if (liveState) {
      wallet.liveNonce = "0";
      wallet.validatorInstalled = false;
      if (!wallet.deployedWalletAddress) {
        wallet.status = wallet.predictedWalletAddress ? "predicted" : wallet.status;
      }
      wallet.updatedAt = nowIso();
    }
  }
  return wallet;
}

async function ensureDispatcher(state, wallet, fallbackDispatcherAddress, options = {}) {
  const normalizedFallbackDispatcherAddress = getAddress(fallbackDispatcherAddress);
  const currentDispatcherAddress = wallet.dispatcherAddress ? getAddress(wallet.dispatcherAddress) : null;
  const dispatcherMatchesDeployment = currentDispatcherAddress === normalizedFallbackDispatcherAddress;
  logApprovalStep("ensureDispatcher:start", {
    walletAddress: wallet.predictedWalletAddress,
    existingDispatcherAddress: wallet.dispatcherAddress ?? null,
    fallbackDispatcherAddress: normalizedFallbackDispatcherAddress
  });
  if (process.env.APP_DISABLE_DISPATCHER_RUNTIME === "true" || !getEnv("PRIVATE_KEY")) {
    wallet.dispatcherAddress = wallet.dispatcherAddress ?? normalizedFallbackDispatcherAddress;
    wallet.dispatcherPreparedAt = wallet.dispatcherPreparedAt ?? nowIso();
    wallet.updatedAt = nowIso();
    logApprovalStep("ensureDispatcher:runtime-disabled", {
      dispatcherAddress: wallet.dispatcherAddress
    });
    return { dispatcherAddress: wallet.dispatcherAddress };
  }

  const requiresDerivedFunding = options.fundDerived === true;
  if (
    !requiresDerivedFunding
    && !dispatcherMatchesDeployment
    && wallet.dispatcherAddress
    && wallet.dispatcherPreparedAt
  ) {
    logApprovalStep("ensureDispatcher:cached", {
      dispatcherAddress: wallet.dispatcherAddress,
      dispatcherPreparedAt: wallet.dispatcherPreparedAt,
      dispatcherDerivedPreparedAt: wallet.dispatcherDerivedPreparedAt ?? null
    });
    return { dispatcherAddress: wallet.dispatcherAddress };
  }

  if (!wallet.predictedWalletAddress) {
    throw new Error("Wallet prediction is required before preparing the dispatcher");
  }

  if (wallet.dispatcherAddress && dispatcherMatchesDeployment) {
    logApprovalStep("ensureDispatcher:stale", {
      storedDispatcherAddress: wallet.dispatcherAddress,
      deploymentDispatcherAddress: normalizedFallbackDispatcherAddress
    });
  }

  const prepared = await prepareWalletDispatcher(
    wallet.predictedWalletAddress,
    wallet.dispatcherAddress && !dispatcherMatchesDeployment ? wallet.dispatcherAddress : null,
    {
    fundDerived: requiresDerivedFunding
    }
  );
  wallet.dispatcherAddress = prepared.dispatcherAddress;
  wallet.dispatcherPreparedAt = nowIso();
  if (requiresDerivedFunding && prepared.dispatcherDerivedFundTx) {
    wallet.dispatcherDerivedPreparedAt = nowIso();
  } else if (requiresDerivedFunding && prepared.dispatcherDerivedBalance) {
    wallet.dispatcherDerivedPreparedAt = nowIso();
  }
  wallet.updatedAt = nowIso();
  logApprovalStep("ensureDispatcher:done", {
    dispatcherAddress: prepared.dispatcherAddress,
    walletTopUpTx: prepared.walletTopUpTx ?? null,
    dispatcherDerivedFundTx: prepared.dispatcherDerivedFundTx ?? null
  });
  return prepared;
}

async function prepareSessionRuntime(state, session, request, options = {}) {
  const wallet = await ensureWallet(state, session.ownerAddress);
  const config = await getContractsConfig();
  const dispatcher = await ensureDispatcher(
    state,
    wallet,
    config.hubDeployment.contracts.crossChainDispatcher,
    options
  );
  const maxAmount = BigInt(request.program.instructions[0].amount);
  const beneficiary = request.program.instructions[3].accountId32;
  const paraId = request.program.instructions[2].paraId;
  const walletAddress = wallet.deployedWalletAddress ?? wallet.predictedWalletAddress;
  const sessionInstallData = buildSessionInstallData(
    session.sessionPublicKey,
    dispatcher.dispatcherAddress,
    beneficiary,
    maxAmount,
    paraId,
    session.expiresAt
  );

  session.walletAddress = walletAddress;
  session.walletStatus = wallet.status;
  session.validatorAddress = config.hubDeployment.contracts.sessionKeyValidatorModule;
  session.allowedTarget = dispatcher.dispatcherAddress;
  session.allowedSelector = EXECUTE_PROGRAM_SELECTOR;
  session.allowedEndpointKinds = [0];
  session.allowedInstructionKinds = [0, 2, 3, 4];
  session.allowedDestinationParaIds = [paraId];
  session.allowedBeneficiaries = [beneficiary];
  session.assetLimits = [{ assetId: PAS_ASSET_ID, maxAmount: maxAmount.toString() }];
  session.bootstrap = {
    mode: wallet.status === "deployed" ? "owner-install" : "userop-bootstrap",
    initCode: wallet.status === "deployed" ? "0x" : buildInitCode(config, wallet.ownerAddress),
    callData: wallet.status === "deployed"
      ? buildOwnerInstallCallData(config, sessionInstallData)
      : buildBootstrapCallData(config, sessionInstallData),
    ownerInstallCallData: buildOwnerInstallCallData(config, sessionInstallData),
    ownerUninstallCallData: wallet.validatorInstalled ? buildOwnerUninstallCallData(config) : "0x",
    rotateExisting: Boolean(wallet.validatorInstalled),
    sessionInstallData
  };
  session.executionDraft = buildExecutionDraft(config, request, walletAddress, dispatcher.dispatcherAddress);
  session.updatedAt = nowIso();

  return {
    session,
    wallet,
    dispatcher
  };
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

  const state = await readOwnerState(payload.ownerAddress);
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
  await writeOwnerState(payload.ownerAddress, toSerializable(state));
  return toSerializable(request);
}

export async function listRequests(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  return state.requests;
}

export async function getRequestById(id, ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const request = state.requests.find((entry) => entry.id === id);
  if (!request) {
    throw new Error("Request not found");
  }
  return request;
}

export async function rejectRequest(id, ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const request = state.requests.find((entry) => entry.id === id);
  if (!request) {
    throw new Error("Request not found");
  }
  const requestIndex = state.requests.findIndex((entry) => entry.id === id);
  state.requests.splice(requestIndex, 1);
  await writeOwnerState(request.userId, state);
  return request;
}

export async function approveRequest(id, ownerAddress) {
  const startedAt = Date.now();
  logApprovalStep("start", { id, ownerAddress: ownerAddress ?? null });
  const state = await readOwnerState(ownerAddress);
  const request = state.requests.find((entry) => entry.id === id);
  if (!request) {
    throw new Error("Request not found");
  }
  if (request.status !== "pending") {
    throw new Error(`Request is already ${request.status}`);
  }
  if (ownerAddress && getAddress(ownerAddress) !== getAddress(request.userId)) {
    throw new Error("Approval ownerAddress must match the request ownerAddress");
  }
  logApprovalStep("request-loaded", {
    requestId: request.id,
    ownerAddress: request.userId,
    sessionPublicKey: request.sessionPublicKey,
    targetChain: request.targetChain
  });

  const wallet = await ensureWallet(state, request.userId);
  const config = await getContractsConfig();
  logApprovalStep("contracts-loaded", {
    walletFactory: config.hubDeployment.contracts.walletFactory,
    dispatcher: config.hubDeployment.contracts.crossChainDispatcher,
    validator: config.hubDeployment.contracts.sessionKeyValidatorModule
  });
  const expiresAt = new Date(Date.now() + DEFAULT_SESSION_DURATION_SECONDS * 1000).toISOString();
  const maxAmount = BigInt(request.program.instructions[0].amount);
  const beneficiary = request.program.instructions[3].accountId32;
  const paraId = request.program.instructions[2].paraId;
  logApprovalStep("session-constraints", {
    expiresAt,
    maxAmount: maxAmount.toString(),
    beneficiary,
    paraId
  });
  const session = {
    id: makeId("session"),
    requestId: request.id,
    ownerAddress: wallet.ownerAddress,
    walletAddress: wallet.deployedWalletAddress ?? wallet.predictedWalletAddress,
    walletStatus: wallet.status,
    agentId: APP_AGENT_ID,
    sessionPublicKey: request.sessionPublicKey,
    targetChain: request.targetChain,
    validatorAddress: config.hubDeployment.contracts.sessionKeyValidatorModule,
    allowedTarget: null,
    allowedSelector: EXECUTE_PROGRAM_SELECTOR,
    allowedEndpointKinds: [0],
    allowedInstructionKinds: [0, 2, 3, 4],
    allowedDestinationParaIds: [paraId],
    allowedBeneficiaries: [beneficiary],
    assetLimits: [{ assetId: PAS_ASSET_ID, maxAmount: maxAmount.toString() }],
    expiresAt,
    status: "approved",
    bootstrap: {
      mode: wallet.status === "deployed" ? "owner-install" : "userop-bootstrap",
      initCode: wallet.status === "deployed" ? "0x" : buildInitCode(config, wallet.ownerAddress),
      callData: null,
      ownerInstallCallData: null,
      ownerUninstallCallData: wallet.validatorInstalled ? buildOwnerUninstallCallData(config) : "0x",
      rotateExisting: Boolean(wallet.validatorInstalled),
      sessionInstallData: null
    },
    executionDraft: null,
    approvedAt: nowIso(),
    updatedAt: nowIso()
  };

  request.status = "approved";
  request.sessionId = session.id;
  request.updatedAt = nowIso();
  state.sessions.unshift(session);
  logApprovalStep("state-write:start", {
    requestId: request.id,
    sessionId: session.id
  });
  await writeOwnerState(request.userId, toSerializable(state));
  logApprovalStep("state-write:done", {
    requestId: request.id,
    sessionId: session.id,
    elapsedMs: Date.now() - startedAt
  });
  return {
    ...sanitizeSession(session),
    approvalMeta: {
      dispatcherTransactions: []
    }
  };
}

export async function prepareSessionForExecution(sessionId, ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  const request = state.requests.find((entry) => entry.id === session.requestId) ?? null;

  const config = await getContractsConfig();
  const wallet = await ensureWallet(state, session.ownerAddress);
  const currentDispatcherAddress = getAddress(config.hubDeployment.contracts.crossChainDispatcher);
  const walletDispatcherAddress = wallet.dispatcherAddress ? getAddress(wallet.dispatcherAddress) : null;
  const sessionMatchesWalletDispatcher =
    session.allowedTarget
    && walletDispatcherAddress
    && getAddress(session.allowedTarget) === walletDispatcherAddress
    && walletDispatcherAddress !== currentDispatcherAddress;
  const sessionHasRuntime = Boolean(session.bootstrap && session.executionDraft && session.walletAddress);
  if (sessionMatchesWalletDispatcher && sessionHasRuntime) {
    return sanitizeSession(session);
  }
  if (!request && session.status === "active" && sessionHasRuntime) {
    return sanitizeSession(session);
  }
  if (!request) {
    throw new Error("Request not found");
  }

  logApprovalStep("prepare-session:start", {
    sessionId,
    requestId: session.requestId,
    ownerAddress: session.ownerAddress,
    currentDispatcherAddress,
    walletDispatcherAddress
  });
  const startedAt = Date.now();
  const prepared = await prepareSessionRuntime(state, session, request, { fundDerived: false });
  logApprovalStep("prepare-session:runtime-ready", {
    sessionId,
    dispatcherAddress: prepared.dispatcher.dispatcherAddress,
    walletTopUpTx: prepared.dispatcher.walletTopUpTx ?? null
  });
  await writeOwnerState(session.ownerAddress, toSerializable(state));
  logApprovalStep("prepare-session:done", {
    sessionId,
    elapsedMs: Date.now() - startedAt
  });
  return sanitizeSession(session);
}

export async function listSessions(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  return state.sessions.map((session) => sanitizeSession(session));
}

export async function removeSessionById(id, ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const sessionIndex = state.sessions.findIndex((entry) => entry.id === id);
  if (sessionIndex === -1) {
    throw new Error("Session not found");
  }

  const [session] = state.sessions.splice(sessionIndex, 1);
  const request = state.requests.find((entry) => entry.id === session.requestId);
  if (request?.sessionId === session.id) {
    delete request.sessionId;
    if (request.status !== "rejected") {
      request.status = "approved";
    }
    request.updatedAt = nowIso();
  }

  state.executions = state.executions.filter((entry) => entry.sessionId !== session.id);
  await writeOwnerState(session.ownerAddress, toSerializable(state));
  return sanitizeSession(session);
}

export async function getSessionById(id, ownerAddress) {
  return getSessionRecord(id, { ownerAddress });
}

export async function getSessionRecord(id, options = {}) {
  const state = await readOwnerState(options.ownerAddress);
  const session = state.sessions.find((entry) => entry.id === id);
  if (!session) {
    throw new Error("Session not found");
  }
  return sanitizeSession(session);
}

export async function listExecutions(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  return state.executions;
}

export async function getWalletStatus(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const wallet = await ensureWallet(state, ownerAddress);
  await writeOwnerState(ownerAddress, state);
  return wallet;
}

export async function getWalletRecord(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  return ensureWallet(state, ownerAddress);
}

export async function prepareWalletForOwner(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const wallet = await ensureWallet(state, ownerAddress);
  const config = await getContractsConfig();
  const dispatcher = await ensureDispatcher(
    state,
    wallet,
    config.hubDeployment.contracts.crossChainDispatcher,
    { fundDerived: true }
  );

  await writeOwnerState(ownerAddress, toSerializable(state));

  return {
    wallet: toSerializable(wallet),
    preparation: {
      dispatcherAddress: dispatcher.dispatcherAddress ?? null,
      dispatcherDeployTx: dispatcher.dispatcherDeployTx ?? null,
      walletTopUpTx: dispatcher.walletTopUpTx ?? null,
      dispatcherTopUpTx: dispatcher.dispatcherTopUpTx ?? null,
      dispatcherDerivedAccountId32: dispatcher.dispatcherDerivedAccountId32 ?? null,
      dispatcherDerivedBalance: dispatcher.dispatcherDerivedBalance ?? null,
      dispatcherDerivedFundTx: dispatcher.dispatcherDerivedFundTx ?? null
    }
  };
}

export async function deployWalletForOwner(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const wallet = await ensureWallet(state, ownerAddress);
  wallet.deployedWalletAddress = wallet.predictedWalletAddress ?? wallet.deployedWalletAddress;
  wallet.status = wallet.deployedWalletAddress ? "deployed" : "simulated";
  wallet.updatedAt = nowIso();

  for (const session of state.sessions) {
    if (getAddress(session.ownerAddress) === getAddress(wallet.ownerAddress) && session.status === "approved") {
      session.status = "active";
      session.walletAddress = wallet.deployedWalletAddress ?? session.walletAddress;
      session.walletStatus = wallet.status;
      if (session.executionDraft) {
        session.executionDraft.walletAddress = session.walletAddress;
      }
      session.updatedAt = nowIso();
    }
  }

  await writeOwnerState(ownerAddress, state);
  return wallet;
}

export async function markSessionSubmitted(sessionId, updates, ownerAddress) {
  const resolvedOwnerAddress = ownerAddress ?? updates?.ownerAddress;
  if (!resolvedOwnerAddress) {
    throw new Error("ownerAddress is required");
  }

  const state = await readOwnerState(resolvedOwnerAddress);
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
  await writeOwnerState(session.ownerAddress, state);
  return session;
}

export async function markExecutionSubmitted(executionId, updates, ownerAddress) {
  const resolvedOwnerAddress = ownerAddress ?? updates?.ownerAddress;
  if (!resolvedOwnerAddress) {
    throw new Error("ownerAddress is required");
  }

  const state = await readOwnerState(resolvedOwnerAddress);
  const execution = state.executions.find((entry) => entry.id === executionId);
  if (!execution) {
    throw new Error("Execution not found");
  }

  execution.status = "submitted";
  execution.hubTxHash = updates.hubTxHash ?? execution.hubTxHash;
  execution.userOpHash = updates.userOpHash ?? execution.userOpHash;
  execution.updatedAt = nowIso();
  await writeOwnerState(execution.ownerAddress, state);
  return execution;
}

export async function executeAgentRequest({ requestId, sessionId }) {
  return executeAgentRequestWithOptions({ requestId, sessionId });
}

export async function executeAgentRequestWithOptions({ requestId, sessionId, ownerAddress, resultOverride, statusOverride }) {
  if (!requestId || !sessionId) {
    throw new Error("requestId and sessionId are required");
  }

  const state = await readOwnerState(ownerAddress);
  const request = state.requests.find((entry) => entry.id === requestId);
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (request && session.requestId !== request.id) {
    throw new Error("sessionId does not belong to requestId");
  }
  if (session.status !== "active") {
    throw new Error("Session is not active");
  }

  const requestIdForExecution = request?.id ?? session.requestId ?? requestId;
  const execution = {
    id: makeId("exec"),
    sessionId: session.id,
    requestId: requestIdForExecution,
    routeType: request?.routeType ?? "xcm",
    sourceChain: request?.sourceChain ?? "polkadot-hub-testnet",
    destinationChain: request?.targetChain ?? session.targetChain,
    status: statusOverride ?? (ENABLE_CHAIN_SUBMISSION ? "submitted" : "simulated"),
    hubTxHash: ENABLE_CHAIN_SUBMISSION ? null : `0x${nodeRandomBytes(32).toString("hex")}`,
    remoteTxHash: null,
    result: resultOverride ?? {
      mode: ENABLE_CHAIN_SUBMISSION ? "live-disabled-in-codepath" : "simulation",
      requestId: session.executionDraft?.requestId ?? requestIdForExecution,
      executionCalldata: session.executionDraft?.executionCalldata ?? null
    },
    createdAt: nowIso()
  };

  if (request) {
    request.status = "executed";
    request.updatedAt = nowIso();
  }
  session.updatedAt = nowIso();
  state.executions.unshift(execution);
  await writeOwnerState(session.ownerAddress, state);
  return execution;
}

export async function getPortalSnapshot(ownerAddress) {
  const state = await readOwnerState(ownerAddress);
  const wallet = await ensureWallet(state, ownerAddress);
  return {
    wallet,
    requests: state.requests,
    sessions: state.sessions.map((session) => sanitizeSession(session)),
    executions: state.executions
  };
}
