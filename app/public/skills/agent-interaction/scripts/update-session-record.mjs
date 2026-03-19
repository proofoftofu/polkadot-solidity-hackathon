import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const [, , sessionPublicKey, ...args] = process.argv;

if (!sessionPublicKey) {
  console.error("Usage: node scripts/update-session-record.mjs <session-public-key> [--field value ...]");
  process.exit(1);
}

const updates = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    console.error("Arguments must be provided as --field value");
    process.exit(1);
  }
  updates[key.slice(2)] = value;
}

const state = readState();
const record = state.sessions.find((entry) => entry.sessionPublicKey.toLowerCase() === sessionPublicKey.toLowerCase());

if (!record) {
  console.error(`Session record not found for ${sessionPublicKey}`);
  process.exit(1);
}

Object.assign(record, updates, { updatedAt: new Date().toISOString() });
writeState(state);

console.log(JSON.stringify({ record }, null, 2));
