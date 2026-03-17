import crypto from "node:crypto";
import os from "node:os";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_STATE = {
  wallets: [],
  requests: [],
  sessions: [],
  executions: []
};

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(LIB_DIR, "..");
const STATE_PATH = process.env.APP_STATE_PATH
  ? path.resolve(process.env.APP_STATE_PATH)
  : path.join(os.tmpdir(), "agent-wallet-app-state.json");

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

async function ensureStore() {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  try {
    await readFile(STATE_PATH, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeFile(STATE_PATH, JSON.stringify(cloneDefaultState(), null, 2));
  }
  return STATE_PATH;
}

export async function readState() {
  const storePath = await ensureStore();
  const raw = await readFile(storePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) {
    return cloneDefaultState();
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`State store is unreadable: ${error.message}`);
  }
}

export async function writeState(state) {
  const storePath = await ensureStore();
  const tempPath = `${storePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2));
  await rename(tempPath, storePath);
  return state;
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
