import test from "node:test";
import assert from "node:assert/strict";

import { resolveWeb3AuthEnv } from "../src/web3authConfig.js";

test("resolveWeb3AuthEnv defaults to devnet and reports missing client id", () => {
  const config = resolveWeb3AuthEnv({});

  assert.equal(config.clientId, "");
  assert.equal(config.network, "sapphire_devnet");
  assert.equal(config.hasClientId, false);
});

test("resolveWeb3AuthEnv keeps supported network values", () => {
  const config = resolveWeb3AuthEnv({
    VITE_WEB3AUTH_CLIENT_ID: "abc123",
    VITE_WEB3AUTH_NETWORK: "sapphire_mainnet"
  });

  assert.equal(config.clientId, "abc123");
  assert.equal(config.network, "sapphire_mainnet");
  assert.equal(config.hasClientId, true);
});

test("resolveWeb3AuthEnv falls back when the network is unsupported", () => {
  const config = resolveWeb3AuthEnv({
    VITE_WEB3AUTH_CLIENT_ID: "abc123",
    VITE_WEB3AUTH_NETWORK: "invalid"
  });

  assert.equal(config.network, "sapphire_devnet");
});
