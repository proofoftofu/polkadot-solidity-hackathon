import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const APP_ENV_PATH = path.join(process.cwd(), ".env.local");
const CONTRACTS_ENV_PATH = path.join(process.cwd(), "..", "contracts", ".env");

let cachedEnv;

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadEnv() {
  if (!cachedEnv) {
    cachedEnv = {
      ...parseEnvFile(CONTRACTS_ENV_PATH),
      ...parseEnvFile(APP_ENV_PATH),
      ...process.env
    };
  }
  return cachedEnv;
}

export function getEnv(name, fallback = undefined) {
  const env = loadEnv();
  return env[name] ?? fallback;
}

export function getRequiredEnv(name) {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
