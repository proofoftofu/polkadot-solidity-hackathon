import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  approveSessionRequest,
  createSessionRequest,
  executeSessionCommand,
  readPortalState,
  rejectSessionRequest
} from "../lib/portal-store.js";

function makeStorePath(name) {
  return path.join(os.tmpdir(), `agent-interaction-${name}-${Date.now()}.json`);
}

test("creates and persists a pending session request", async () => {
  const storePath = makeStorePath("request");
  const request = await createSessionRequest(
    { agentName: "codex-agent", requestedAction: "wallet.viewBalance" },
    storePath
  );

  const state = await readPortalState(storePath);
  assert.equal(request.status, "pending");
  assert.equal(state.requests[0].requestedAction, "wallet.viewBalance");
});

test("approves a request and creates a scoped session", async () => {
  const storePath = makeStorePath("approve");
  const request = await createSessionRequest(
    { agentName: "codex-agent", requestedAction: "wallet.sendTestToken" },
    storePath
  );

  const session = await approveSessionRequest(request.id, storePath);
  assert.equal(session.allowedAction, "wallet.sendTestToken");

  const state = await readPortalState(storePath);
  assert.equal(state.requests[0].status, "approved");
  assert.equal(state.sessions[0].requestId, request.id);
});

test("rejects a pending request", async () => {
  const storePath = makeStorePath("reject");
  const request = await createSessionRequest(
    { agentName: "codex-agent", requestedAction: "wallet.signDemoMessage" },
    storePath
  );

  const rejected = await rejectSessionRequest(request.id, storePath);
  assert.equal(rejected.status, "rejected");
});

test("executes only the approved command", async () => {
  const storePath = makeStorePath("execute");
  const request = await createSessionRequest(
    { agentName: "codex-agent", requestedAction: "wallet.viewBalance" },
    storePath
  );
  const session = await approveSessionRequest(request.id, storePath);

  const execution = await executeSessionCommand(
    {
      sessionToken: session.token,
      command: "wallet.viewBalance",
      payload: {}
    },
    storePath
  );

  assert.equal(execution.command, "wallet.viewBalance");
  assert.equal(execution.result.balance.asset, "USDC");

  await assert.rejects(
    () =>
      executeSessionCommand(
        {
          sessionToken: session.token,
          command: "wallet.sendTestToken",
          payload: {}
        },
        storePath
      ),
    /Command is not allowed/
  );
});
