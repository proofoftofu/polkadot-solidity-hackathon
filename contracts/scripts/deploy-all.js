import {
  DEFAULT_MESSAGE_PREFIX,
  NETWORKS,
  XCM_PRECOMPILE,
  buildMoonbeamDestination,
  createClients,
  deployFromArtifact,
  getContract,
  readArtifact,
  updateAddressesIndex,
  writeDeployment
} from "./common.js";

async function deployPolkadotHub() {
  const { account, publicClient, walletClient } = createClients("polkadotTestnet");

  const entryPointArtifact = await readArtifact("mocks/MockEntryPoint.sol", "MockEntryPoint");
  const walletFactoryArtifact = await readArtifact("WalletFactory.sol", "WalletFactory");
  const validatorArtifact = await readArtifact("SessionKeyValidatorModule.sol", "SessionKeyValidatorModule");
  const executionArtifact = await readArtifact("ExecutionModule.sol", "ExecutionModule");
  const paymasterArtifact = await readArtifact("SponsoredExecutionPaymaster.sol", "SponsoredExecutionPaymaster");
  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");

  const entryPoint = await deployFromArtifact(walletClient, publicClient, entryPointArtifact);
  const walletFactory = await deployFromArtifact(walletClient, publicClient, walletFactoryArtifact, [entryPoint]);
  const sessionKeyValidatorModule = await deployFromArtifact(walletClient, publicClient, validatorArtifact);
  const executionModule = await deployFromArtifact(walletClient, publicClient, executionArtifact);
  const sponsoredExecutionPaymaster = await deployFromArtifact(walletClient, publicClient, paymasterArtifact, [
    account.address,
    entryPoint
  ]);

  const moonbeamAccountKey20 = process.env.MOONBEAM_ACCOUNT_KEY20 ?? account.address;
  const moonbeamDestination = process.env.MOONBEAM_DESTINATION ?? buildMoonbeamDestination(moonbeamAccountKey20);
  const messagePrefix = process.env.XCM_MESSAGE_PREFIX ?? DEFAULT_MESSAGE_PREFIX;
  const crossChainDispatcher = await deployFromArtifact(walletClient, publicClient, dispatcherArtifact, [
    account.address,
    XCM_PRECOMPILE,
    BigInt(NETWORKS.moonbaseAlpha.chainId),
    moonbeamDestination
  ]);

  const dispatcher = await getContract(walletClient, publicClient, dispatcherArtifact, crossChainDispatcher);
  await publicClient.waitForTransactionReceipt({
    hash: await dispatcher.write.setMessagePrefix([messagePrefix])
  });

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
      xcmPrecompile: XCM_PRECOMPILE,
      messagePrefix
    }
  };

  await writeDeployment("polkadotTestnet", deployment);
  await updateAddressesIndex("polkadotTestnet", deployment);
  return deployment;
}

async function deployMoonbeam(hubDeployment) {
  const { account, publicClient, walletClient } = createClients("moonbaseAlpha");

  const targetArtifact = await readArtifact("mocks/MockTarget.sol", "MockTarget");
  const receiverArtifact = await readArtifact("CrossChainReceiver.sol", "CrossChainReceiver");

  const crossChainTarget = await deployFromArtifact(walletClient, publicClient, targetArtifact);
  const trustedRelayer = process.env.MOONBEAM_TRUSTED_RELAYER ?? account.address;
  const crossChainReceiver = await deployFromArtifact(walletClient, publicClient, receiverArtifact, [
    trustedRelayer,
    hubDeployment.contracts.crossChainDispatcher
  ]);

  const deployment = {
    network: "moonbaseAlpha",
    deployer: account.address,
    chainId: NETWORKS.moonbaseAlpha.chainId,
    contracts: {
      crossChainTarget,
      crossChainReceiver,
      trustedRelayer,
      trustedHubDispatcher: hubDeployment.contracts.crossChainDispatcher
    }
  };

  await writeDeployment("moonbaseAlpha", deployment);
  await updateAddressesIndex("moonbaseAlpha", deployment);
  return deployment;
}

async function configureHubAllowlist(hubDeployment, moonbeamDeployment) {
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
}

async function main() {
  const hubDeployment = await deployPolkadotHub();
  const moonbeamDeployment = await deployMoonbeam(hubDeployment);
  await configureHubAllowlist(hubDeployment, moonbeamDeployment);

  console.log("Deployed contracts to both networks.");
  console.log(`Polkadot Hub dispatcher: ${hubDeployment.contracts.crossChainDispatcher}`);
  console.log(`Moonbase receiver: ${moonbeamDeployment.contracts.crossChainReceiver}`);
  console.log(`Moonbase target: ${moonbeamDeployment.contracts.crossChainTarget}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
