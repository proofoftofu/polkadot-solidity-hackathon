import test from "node:test";
import assert from "node:assert/strict";

import { appState } from "../lib/mock-data.js";

test("selected request includes all approval-critical fields", () => {
  const pendingSession = appState.sessions.find((session) => session.status === "pending");

  assert.ok(pendingSession, "expected a pending session");

  for (const field of [
    "approvalChain",
    "targetChain",
    "contract",
    "selector",
    "scope",
    "expiry",
    "valueCap",
    "sponsorship"
  ]) {
    assert.ok(pendingSession[field], `expected ${field} to be present`);
  }
});

test("companion narration covers the minimal demo flow", () => {
  assert.ok(Object.keys(appState.sessionHistory).length > 0);
  assert.ok(appState.activity.afterApproval(appState.sessions[0]).title);
  assert.ok(appState.activity.afterRevoke(appState.sessions[0]).title);
  assert.ok(appState.activity.afterNewSession(appState.sessionTemplates[0]).title);
});
