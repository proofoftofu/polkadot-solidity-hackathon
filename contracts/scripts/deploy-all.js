import {
  NETWORKS,
  XCM_PRECOMPILE,
  beneficiarySs58,
  createClients,
  createSubstrateApi,
  deployFromArtifact,
  readArtifact,
  updateAddressesIndex,
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
  const crossChainDispatcher = await deployFromArtifact(
    walletClient,
    publicClient,
    dispatcherArtifact,
    [account.address, XCM_PRECOMPILE],
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
      xcmPrecompile: XCM_PRECOMPILE
    }
  };

  await writeDeployment("polkadotTestnet", deployment);
  await updateAddressesIndex("polkadotTestnet", deployment);
  return deployment;
}

async function configurePeopleChainRoute() {
  const peopleApi = await createSubstrateApi("peoplePaseo");

  const beneficiary = process.env.PEOPLE_PASEO_BENEFICIARY
    ?? "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
  const peopleParaId = Number((await peopleApi.query.parachainInfo.parachainId()).toString());

  const deployment = {
    network: "peoplePaseo",
    paraId: peopleParaId,
    beneficiary,
    beneficiarySs58: beneficiarySs58(beneficiary, 0)
  };

  await peopleApi.disconnect();
  await writeDeployment("peoplePaseo", deployment);
  await updateAddressesIndex("peoplePaseo", { contracts: deployment });
  return deployment;
}

async function main() {
  const hubDeployment = await deployPolkadotHub();
  const peopleDeployment = await configurePeopleChainRoute();

  console.log("Deployed Hub contracts and configured People Chain smoke test.");
  console.log(`Polkadot Hub dispatcher: ${hubDeployment.contracts.crossChainDispatcher}`);
  console.log(`People Chain paraId: ${peopleDeployment.paraId}`);
  console.log(`People Chain beneficiary: ${peopleDeployment.beneficiarySs58}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
