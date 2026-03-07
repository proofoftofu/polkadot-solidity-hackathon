import fs from "node:fs/promises";
import path from "node:path";

import { artifacts } from "hardhat";

const CONTRACTS = [
  "AgentSmartWallet",
  "WalletFactory",
  "SessionKeyValidatorModule",
  "ExecutionModule",
  "SponsoredExecutionPaymaster",
  "CrossChainDispatcher",
  "CrossChainReceiver"
];

async function main() {
  const outDir = path.join(process.cwd(), "deployments", "abi");
  await fs.mkdir(outDir, { recursive: true });

  for (const name of CONTRACTS) {
    const artifact = await artifacts.readArtifact(name);
    await fs.writeFile(path.join(outDir, `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
