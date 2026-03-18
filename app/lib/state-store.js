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
const STATE_BACKEND = process.env.APP_STATE_BACKEND ?? "file";
const REDIS_URL = process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? null;

let redisClientPromise;

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeOwnerKey(ownerAddress) {
  return (ownerAddress ?? "default").toLowerCase();
}

function getNamespaceKey(ownerAddress) {
  return `polkadot-solidity-hackathon:agent-wallet:${normalizeOwnerKey(ownerAddress)}`;
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

async function getRedisClient() {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is required when APP_STATE_BACKEND=redis");
  }
  if (!redisClientPromise) {
    redisClientPromise = import("redis").then(async ({ createClient }) => {
      const client = createClient({ url: REDIS_URL });
      client.on("error", (error) => {
        console.error("[state-store] redis error", error);
      });
      if (!client.isOpen) {
        await client.connect();
      }
      return client;
    });
  }
  return redisClientPromise;
}

async function readFileState(ownerAddress) {
  const storePath = await ensureStore();
  const raw = await readFile(storePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) {
    return cloneDefaultState();
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed.namespaces?.[normalizeOwnerKey(ownerAddress)] ?? cloneDefaultState();
  } catch (error) {
    throw new Error(`State store is unreadable: ${error.message}`);
  }
}

async function writeFileState(ownerAddress, state) {
  const storePath = await ensureStore();
  const tempPath = `${storePath}.${crypto.randomUUID()}.tmp`;
  const raw = await readFile(storePath, "utf8").catch(() => "");
  const parsed = raw.trim() ? JSON.parse(raw) : { namespaces: {} };
  parsed.namespaces ??= {};
  parsed.namespaces[normalizeOwnerKey(ownerAddress)] = state;
  await writeFile(tempPath, JSON.stringify(parsed, null, 2));
  await rename(tempPath, storePath);
  return state;
}

async function readRedisState(ownerAddress) {
  const client = await getRedisClient();
  const raw = await client.get(getNamespaceKey(ownerAddress));
  if (!raw) {
    return cloneDefaultState();
  }
  return JSON.parse(raw);
}

async function writeRedisState(ownerAddress, state) {
  const client = await getRedisClient();
  await client.set(getNamespaceKey(ownerAddress), JSON.stringify(state));
  return state;
}

export async function readState(ownerAddress) {
  return STATE_BACKEND === "redis"
    ? readRedisState(ownerAddress)
    : readFileState(ownerAddress);
}

export async function writeState(ownerAddress, state) {
  return STATE_BACKEND === "redis"
    ? writeRedisState(ownerAddress, state)
    : writeFileState(ownerAddress, state);
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
