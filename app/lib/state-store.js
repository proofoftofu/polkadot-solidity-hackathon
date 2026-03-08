import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE = {
  wallets: [],
  requests: [],
  sessions: [],
  executions: []
};

const STATE_PATH = path.join(process.cwd(), "data", "app-state.json");

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
  return JSON.parse(await readFile(storePath, "utf8"));
}

export async function writeState(state) {
  const storePath = await ensureStore();
  await writeFile(storePath, JSON.stringify(state, null, 2));
  return state;
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
