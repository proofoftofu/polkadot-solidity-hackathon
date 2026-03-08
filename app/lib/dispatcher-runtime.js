import { spawn } from "node:child_process";
import path from "node:path";

import { getRequiredEnv } from "./server-env.js";

const CONTRACTS_CWD = path.join(process.cwd(), "..", "contracts");

function parseOutput(stdout) {
  const result = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [key, ...rest] = trimmed.split(" ");
    if (rest.length === 0) {
      continue;
    }
    result[key] = rest.join(" ");
  }
  return result;
}

export async function prepareWalletDispatcher(walletAddress, existingDispatcherAddress) {
  const operatorPrivateKey = getRequiredEnv("PRIVATE_KEY");
  console.log("[dispatcher-runtime] prepare", { walletAddress, existingDispatcherAddress });

  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/app-prepare-dispatcher.js"], {
      cwd: CONTRACTS_CWD,
      env: {
        ...process.env,
        PRIVATE_KEY: operatorPrivateKey,
        WALLET_ADDRESS: walletAddress,
        ...(existingDispatcherAddress ? { DISPATCHER_ADDRESS: existingDispatcherAddress } : {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `app-prepare-dispatcher.js failed with exit code ${code}`));
        return;
      }

      const parsed = parseOutput(stdout);
      resolve({
        dispatcherAddress: parsed.dispatcherAddress,
        walletAddress: parsed.walletAddress,
        walletBalance: parsed.walletBalance,
        dispatcherBalance: parsed.dispatcherBalance,
        dispatcherDerivedAccountId32: parsed.dispatcherDerivedAccountId32,
        dispatcherDerivedBalance: parsed.dispatcherDerivedBalance,
        stdout,
        stderr
      });
    });
  });
}
