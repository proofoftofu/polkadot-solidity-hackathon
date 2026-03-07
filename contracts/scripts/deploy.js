import fs from "node:fs/promises";
import path from "node:path";

import { network } from "hardhat";
import { encodeAbiParameters, parseAbiParameters, stringToHex } from "viem";

const MOONBASE_CHAIN_ID = 1287n;
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

    const moonbeamDestination =
      process.env.MOONBEAM_DESTINATION ??
      encodeAbiParameters(
        parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
        [1, 2004, deployer.account.address]
      );
    const messagePrefix = process.env.XCM_MESSAGE_PREFIX ?? stringToHex("TOFU_XCM_V1");

    const dispatcher = await viem.deployContract(
      "CrossChainDispatcher",
      [deployer.account.address, POLKADOT_XCM_PRECOMPILE, MOONBASE_CHAIN_ID, moonbeamDestination],
      { client: { wallet: deployer } }
    );
    await dispatcher.write.setMessagePrefix([messagePrefix], { account: deployer.account });

    deployment.contracts = {
      entryPoint: entryPoint.address,
      walletFactory: walletFactory.address,
      sessionKeyValidatorModule: validator.address,
      executionModule: executionModule.address,
      sponsoredExecutionPaymaster: paymaster.address,
      crossChainDispatcher: dispatcher.address,
      moonbeamDestination,
      xcmPrecompile: POLKADOT_XCM_PRECOMPILE,
      messagePrefix
    };
  }

  if (networkName === "moonbaseAlpha" || networkName === "hardhatMainnet") {
    const trustedRelayer = process.env.MOONBEAM_TRUSTED_RELAYER ?? deployer.account.address;
    const trustedDispatcher = process.env.TRUSTED_HUB_DISPATCHER ?? deployer.account.address;
    const receiver = await viem.deployContract("CrossChainReceiver", [trustedRelayer, trustedDispatcher], {
      client: { wallet: deployer }
    });

    deployment.contracts = {
      ...deployment.contracts,
      crossChainReceiver: receiver.address,
      trustedRelayer,
      trustedHubDispatcher: trustedDispatcher
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
