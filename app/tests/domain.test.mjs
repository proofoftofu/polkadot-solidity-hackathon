import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(APP_ROOT, "tests", ".tmp", "app-state.json");
process.env.APP_STATE_PATH = DATA_PATH;
process.env.APP_DISABLE_DISPATCHER_RUNTIME = "true";

async function resetStateFile() {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  await writeFile(
    DATA_PATH,
    JSON.stringify({ wallets: [], requests: [], sessions: [], executions: [] }, null, 2)
  );
}

test.beforeEach(async () => {
  await resetStateFile();
});

test.after(async () => {
  await rm(DATA_PATH, { force: true });
});

test("creates an agent request with normalized explanation", async () => {
  const { createAgentRequest } = await import("../lib/domain.js");
  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });

  assert.equal(request.status, "pending");
  assert.equal(request.targetChain, "people-paseo");
  assert.equal(request.explanation.destinationChain, "People Chain Paseo");
});

test("approval creates a contract-aware session and deploy activates it", async () => {
  const { approveRequest, createAgentRequest, deployWalletForOwner, getSessionById } = await import("../lib/domain.js");

  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });

  const session = await approveRequest(request.id);
  assert.equal(session.status, "approved");
  assert.equal(session.allowedSelector, "0x9d998c8f");
  assert.equal(typeof session.bootstrap.initCode, "string");
  assert.equal(session.sessionPublicKey, "0x1234567890123456789012345678901234567890");

  await deployWalletForOwner(session.ownerAddress);
  const activated = await getSessionById(session.id);
  assert.equal(activated.status, "active");
});

test("execution requires an active session", async () => {
  const { createAgentRequest, approveRequest, executeAgentRequest } = await import("../lib/domain.js");
  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });
  const session = await approveRequest(request.id);

  await assert.rejects(() => executeAgentRequest({ requestId: request.id, sessionId: session.id }), /not active/);
});

test("session lookup never exposes a private key", async () => {
  const { createAgentRequest, approveRequest, getSessionRecord } = await import("../lib/domain.js");
  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });

  const session = await approveRequest(request.id);
  const publicView = await getSessionRecord(session.id);
  assert.equal(publicView.sessionPrivateKey, undefined);
});

test("session execution can continue after the request record is gone", async () => {
  const { createAgentRequest, approveRequest, deployWalletForOwner, executeAgentRequestWithOptions } = await import("../lib/domain.js");
  const { readState, writeState } = await import("../lib/state-store.js");

  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });

  const session = await approveRequest(request.id);
  await deployWalletForOwner(session.ownerAddress);

  const state = await readState(session.ownerAddress);
  state.requests = state.requests.filter((entry) => entry.id !== request.id);
  await writeState(session.ownerAddress, state);

  const execution = await executeAgentRequestWithOptions({
    requestId: request.id,
    sessionId: session.id,
    ownerAddress: session.ownerAddress
  });

  assert.equal(execution.sessionId, session.id);
  assert.equal(execution.destinationChain, "people-paseo");
});

test("markSessionSubmitted activates the session when ownerAddress is provided", async () => {
  const { createAgentRequest, approveRequest, markSessionSubmitted, getSessionById } = await import("../lib/domain.js");

  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });

  const session = await approveRequest(request.id);
  const updated = await markSessionSubmitted(session.id, {
    bootstrapTxHash: "0x" + "11".repeat(32),
    activate: true,
    ownerAddress: session.ownerAddress
  }, session.ownerAddress);

  assert.equal(updated.status, "active");

  const persisted = await getSessionById(session.id, session.ownerAddress);
  assert.equal(persisted.status, "active");
  assert.equal(persisted.bootstrapTxHash, "0x" + "11".repeat(32));
});

test("getPortalSnapshot does not clobber pending requests", async () => {
  const { createAgentRequest, getPortalSnapshot } = await import("../lib/domain.js");

  const request = await createAgentRequest({
    actionType: "execute",
    targetChain: "people-paseo",
    ownerAddress: "0x0Bc298a4a0a205875F5Ae3B19506669c55B38d01",
    sessionPublicKey: "0x1234567890123456789012345678901234567890",
    summary: "Transfer PAS",
    program: {
      transferAmount: "10000000000",
      beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  });

  const before = await getPortalSnapshot("0x0Bc298a4a0a205875F5Ae3B19506669c55B38d01");
  assert.ok(before.requests.some((entry) => entry.id === request.id));

  const after = await getPortalSnapshot("0x0Bc298a4a0a205875F5Ae3B19506669c55B38d01");
  assert.ok(after.requests.some((entry) => entry.id === request.id));
});
