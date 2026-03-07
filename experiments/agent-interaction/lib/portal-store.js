import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_STATE = {
  requests: [],
  sessions: [],
  executions: []
};

const DEFAULT_STORE_PATH = path.join(process.cwd(), "data", "portal-state.json");

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function ensureStoreFile(storePath = DEFAULT_STORE_PATH) {
  await mkdir(path.dirname(storePath), { recursive: true });
  try {
    await readFile(storePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeFile(storePath, JSON.stringify(cloneDefaultState(), null, 2));
  }
  return storePath;
}

export async function readPortalState(storePath = DEFAULT_STORE_PATH) {
  const resolved = await ensureStoreFile(storePath);
  const content = await readFile(resolved, "utf8");
  return JSON.parse(content);
}

export async function writePortalState(state, storePath = DEFAULT_STORE_PATH) {
  const resolved = await ensureStoreFile(storePath);
  await writeFile(resolved, JSON.stringify(state, null, 2));
  return state;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export async function createSessionRequest(
  { agentName, requestedAction },
  storePath = DEFAULT_STORE_PATH
) {
  if (!agentName || !requestedAction) {
    throw new Error("agentName and requestedAction are required");
  }

  const state = await readPortalState(storePath);
  const request = {
    id: makeId("req"),
    agentName,
    requestedAction,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  state.requests.unshift(request);
  await writePortalState(state, storePath);
  return request;
}

async function updateRequestStatus(id, status, storePath = DEFAULT_STORE_PATH) {
  const state = await readPortalState(storePath);
  const request = state.requests.find((item) => item.id === id);

  if (!request) {
    throw new Error("Session request not found");
  }

  if (request.status !== "pending") {
    throw new Error(`Session request is already ${request.status}`);
  }

  request.status = status;
  request.updatedAt = new Date().toISOString();

  await writePortalState(state, storePath);
  return { state, request };
}

export async function rejectSessionRequest(id, storePath = DEFAULT_STORE_PATH) {
  const { request } = await updateRequestStatus(id, "rejected", storePath);
  return request;
}

export async function approveSessionRequest(id, storePath = DEFAULT_STORE_PATH) {
  const { state, request } = await updateRequestStatus(id, "approved", storePath);

  const session = {
    id: makeId("session"),
    requestId: request.id,
    agentName: request.agentName,
    allowedAction: request.requestedAction,
    status: "active",
    token: `sess_${crypto.randomBytes(12).toString("hex")}`,
    approvedAt: new Date().toISOString()
  };

  request.sessionId = session.id;
  state.sessions.unshift(session);
  await writePortalState(state, storePath);
  return session;
}

function buildExecutionResult(command, payload) {
  if (command === "wallet.viewBalance") {
    return {
      summary: "Balance fetched",
      balance: {
        asset: "USDC",
        amount: "1250.00",
        chain: "Polkadot Hub Testnet"
      }
    };
  }

  if (command === "wallet.sendTestToken") {
    return {
      summary: "Sponsored transfer simulated",
      transfer: {
        amount: payload?.amount || "10",
        recipient: payload?.recipient || "5FdemoRecipient11111111111111111111111",
        txHash: `0x${crypto.randomBytes(16).toString("hex")}`
      }
    };
  }

  if (command === "wallet.signDemoMessage") {
    return {
      summary: "Demo message signed",
      signature: `0x${crypto.randomBytes(32).toString("hex")}`,
      message: payload?.message || "Approve demo action"
    };
  }

  return {
    summary: "Generic action executed",
    payload
  };
}

export async function executeSessionCommand(
  { sessionToken, command, payload = {} },
  storePath = DEFAULT_STORE_PATH
) {
  if (!sessionToken || !command) {
    throw new Error("sessionToken and command are required");
  }

  const state = await readPortalState(storePath);
  const session = state.sessions.find((item) => item.token === sessionToken);

  if (!session) {
    throw new Error("Session not found");
  }

  if (session.status !== "active") {
    throw new Error("Session is not active");
  }

  if (session.allowedAction !== command) {
    throw new Error("Command is not allowed for this session");
  }

  const execution = {
    id: makeId("exec"),
    sessionId: session.id,
    command,
    payload,
    executedAt: new Date().toISOString(),
    result: buildExecutionResult(command, payload)
  };

  session.lastExecution = execution.executedAt;
  state.executions.unshift(execution);
  await writePortalState(state, storePath);
  return execution;
}
