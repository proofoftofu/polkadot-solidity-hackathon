import fs from "node:fs/promises";
import path from "node:path";

import { network } from "hardhat";

const POLKADOT_XCM_PRECOMPILE = "0x00000000000000000000000000000000000a0000";

async function main() {
  const { viem } = await network.connect();
  const [deployer] = await viem.getWalletClients();
  const networkName = process.env.HARDHAT_NETWORK ?? "hardhatMainnet";
  const publicClient = await viem.getPublicClient();

  const deployment = {
    network: networkName,
    deployer: deployer.account.address,
    chainId: publicClient.chain.id,
    contracts: {}
  };

  if (networkName === "polkadotTestnet" || networkName === "hardhatMainnet") {
    const entryPoint = await viem.deployContract("MockEntryPoint", [], { client: { wallet: deployer } });
    const walletFactory = await viem.deployContract("WalletFactory", [entryPoint.address], {
      client: { wallet: deployer }
    });
    const validator = await viem.deployContract("SessionKeyValidatorModule", [], { client: { wallet: deployer } });
    const executionModule = await viem.deployContract("ExecutionModule", [], { client: { wallet: deployer } });
    const paymaster = await viem.deployContract("SponsoredExecutionPaymaster", [deployer.account.address, entryPoint.address], {
      client: { wallet: deployer }
    });

    const dispatcher = await viem.deployContract(
      "CrossChainDispatcher",
      [deployer.account.address, POLKADOT_XCM_PRECOMPILE],
      { client: { wallet: deployer } }
    );

    deployment.contracts = {
      entryPoint: entryPoint.address,
      walletFactory: walletFactory.address,
      sessionKeyValidatorModule: validator.address,
      executionModule: executionModule.address,
      sponsoredExecutionPaymaster: paymaster.address,
      crossChainDispatcher: dispatcher.address,
      xcmPrecompile: POLKADOT_XCM_PRECOMPILE
    };
  }

  const outputPath = path.join(process.cwd(), "deployments", `${networkName}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
