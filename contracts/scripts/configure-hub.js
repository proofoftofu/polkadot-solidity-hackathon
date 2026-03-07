import { createClients, getContract, readArtifact, readDeployment, updateAddressesIndex, writeDeployment } from "./common.js";

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");
  const moonbeamDeployment = await readDeployment("moonbaseAlpha");
  const { publicClient, walletClient } = createClients("polkadotTestnet");

  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const dispatcher = await getContract(
    walletClient,
    publicClient,
    dispatcherArtifact,
    hubDeployment.contracts.crossChainDispatcher
  );
  await publicClient.waitForTransactionReceipt({
    hash: await dispatcher.write.setAllowedReceiver([moonbeamDeployment.contracts.crossChainReceiver, true])
  });

  hubDeployment.contracts.allowedReceiver = moonbeamDeployment.contracts.crossChainReceiver;
  await writeDeployment("polkadotTestnet", hubDeployment);
  await updateAddressesIndex("polkadotTestnet", hubDeployment);

  console.log(`Allowed Moonbeam receiver ${moonbeamDeployment.contracts.crossChainReceiver} on Hub dispatcher.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
