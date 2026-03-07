import {
  createClients,
  getContract,
  readArtifact,
  readDeployment,
  updateAddressesIndex,
  writeContract,
  writeDeployment
} from "./common.js";

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");
  const moonbeamDeployment = await readDeployment("moonbaseAlpha");
  const { publicClient, walletClient, nonceManager } = createClients("polkadotTestnet");

  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const dispatcher = await getContract(
    walletClient,
    publicClient,
    dispatcherArtifact,
    hubDeployment.contracts.crossChainDispatcher
  );
  await writeContract(
    dispatcher.write.setAllowedReceiver,
    [moonbeamDeployment.contracts.crossChainTarget, true],
    publicClient,
    nonceManager
  );

  hubDeployment.contracts.allowedReceiver = moonbeamDeployment.contracts.crossChainTarget;
  await writeDeployment("polkadotTestnet", hubDeployment);
  await updateAddressesIndex("polkadotTestnet", hubDeployment);

  console.log(`Allowed Moonbeam target ${moonbeamDeployment.contracts.crossChainTarget} on Hub dispatcher.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
