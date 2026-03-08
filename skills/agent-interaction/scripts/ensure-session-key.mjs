import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { getAddress, isAddress } from "../../../app/node_modules/viem/_esm/index.js";
import { generatePrivateKey, privateKeyToAccount } from "../../../app/node_modules/viem/_esm/accounts/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.resolve(__dirname, "..", "state");
const STATE_PATH = path.join(STATE_DIR, "session-keys.json");

function readState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { sessions: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function isReusable(record, ownerAddress) {
  if (record.ownerAddress !== ownerAddress) {
    return false;
  }
  if (!record.sessionPrivateKey || !record.sessionPublicKey) {
    return false;
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    return false;
  }
  return !record.revoked;
}

const [, , ownerAddressInput] = process.argv;

if (!ownerAddressInput || !isAddress(ownerAddressInput)) {
  console.error("Usage: node scripts/ensure-session-key.mjs <owner-address>");
  process.exit(1);
}

const ownerAddress = getAddress(ownerAddressInput);
const state = readState();

for (const record of state.sessions) {
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    record.status = "expired";
  }
}

const reusable = state.sessions.find((record) => isReusable(record, ownerAddress));
if (reusable) {
  reusable.lastUsedAt = new Date().toISOString();
  writeState(state);
  console.log(JSON.stringify({ reused: true, record: reusable }, null, 2));
  process.exit(0);
}

const sessionPrivateKey = generatePrivateKey();
const sessionPublicKey = privateKeyToAccount(sessionPrivateKey).address;
const record = {
  id: `sk_${randomBytes(6).toString("hex")}`,
  ownerAddress,
  sessionPublicKey,
  sessionPrivateKey,
  status: "generated",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastUsedAt: new Date().toISOString()
};

state.sessions.unshift(record);
writeState(state);

console.log(JSON.stringify({ reused: false, record }, null, 2));
