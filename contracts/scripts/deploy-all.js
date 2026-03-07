import {
  DEFAULT_MOONBASE_PARA_ID,
  NETWORKS,
  XCM_PRECOMPILE,
  createClients,
  createSubstrateApi,
  deployFromArtifact,
  encodeVersionedLocation,
  getContract,
  getHubParaId,
  readArtifact,
  updateAddressesIndex,
  writeContract,
  writeDeployment
} from "./common.js";

async function deployPolkadotHub() {
  const { account, publicClient, walletClient, nonceManager } = createClients("polkadotTestnet");

  const entryPointArtifact = await readArtifact("mocks/MockEntryPoint.sol", "MockEntryPoint");
  const walletFactoryArtifact = await readArtifact("WalletFactory.sol", "WalletFactory");
  const validatorArtifact = await readArtifact("SessionKeyValidatorModule.sol", "SessionKeyValidatorModule");
  const executionArtifact = await readArtifact("ExecutionModule.sol", "ExecutionModule");
  const paymasterArtifact = await readArtifact("SponsoredExecutionPaymaster.sol", "SponsoredExecutionPaymaster");
  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const hubApi = await createSubstrateApi("polkadotTestnet");
  const moonbeamApi = await createSubstrateApi("moonbaseAlpha");

  const entryPoint = await deployFromArtifact(walletClient, publicClient, entryPointArtifact, [], nonceManager);
  const walletFactory =
    await deployFromArtifact(walletClient, publicClient, walletFactoryArtifact, [entryPoint], nonceManager);
  const sessionKeyValidatorModule =
    await deployFromArtifact(walletClient, publicClient, validatorArtifact, [], nonceManager);
  const executionModule =
    await deployFromArtifact(walletClient, publicClient, executionArtifact, [], nonceManager);
  const sponsoredExecutionPaymaster = await deployFromArtifact(
    walletClient,
    publicClient,
    paymasterArtifact,
    [account.address, entryPoint],
    nonceManager
  );

  const moonbaseParaId = await getHubParaId(moonbeamApi);
  const moonbeamDestination = encodeVersionedLocation(hubApi, moonbaseParaId, 1);
  const crossChainDispatcher = await deployFromArtifact(
    walletClient,
    publicClient,
    dispatcherArtifact,
    [account.address, XCM_PRECOMPILE, BigInt(NETWORKS.moonbaseAlpha.chainId), moonbeamDestination],
    nonceManager
  );

  const deployment = {
    network: "polkadotTestnet",
    deployer: account.address,
    chainId: NETWORKS.polkadotTestnet.chainId,
    contracts: {
      entryPoint,
      walletFactory,
      sessionKeyValidatorModule,
      executionModule,
      sponsoredExecutionPaymaster,
      crossChainDispatcher,
      moonbeamDestination,
      moonbaseParaId,
      xcmPrecompile: XCM_PRECOMPILE
    }
  };

  await hubApi.disconnect();
  await moonbeamApi.disconnect();
  await writeDeployment("polkadotTestnet", deployment);
  await updateAddressesIndex("polkadotTestnet", deployment);
  return deployment;
}

async function deployMoonbeam(hubDeployment) {
  const { account, publicClient, walletClient, nonceManager } = createClients("moonbaseAlpha");

  const targetArtifact = await readArtifact("mocks/MockTarget.sol", "MockTarget");
  const crossChainTarget = await deployFromArtifact(walletClient, publicClient, targetArtifact, [], nonceManager);

  const deployment = {
    network: "moonbaseAlpha",
    deployer: account.address,
    chainId: NETWORKS.moonbaseAlpha.chainId,
    contracts: {
      crossChainTarget,
      trustedHubDispatcher: hubDeployment.contracts.crossChainDispatcher
    }
  };

  await writeDeployment("moonbaseAlpha", deployment);
  await updateAddressesIndex("moonbaseAlpha", deployment);
  return deployment;
}

async function configureHubAllowlist(hubDeployment, moonbeamDeployment) {
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
}

async function main() {
  const hubDeployment = await deployPolkadotHub();
  const moonbeamDeployment = await deployMoonbeam(hubDeployment);
  await configureHubAllowlist(hubDeployment, moonbeamDeployment);

  console.log("Deployed contracts to both networks.");
  console.log(`Polkadot Hub dispatcher: ${hubDeployment.contracts.crossChainDispatcher}`);
  console.log(`Moonbase target: ${moonbeamDeployment.contracts.crossChainTarget}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
