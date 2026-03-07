import {
  buildContractSmokeMessage,
  createClients,
  createSubstrateApi,
  getContract,
  readArtifact,
  readDeployment
} from "./common.js";

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");

  const hub = createClients("polkadotTestnet");
  const hubApi = await createSubstrateApi("polkadotTestnet");

  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const dispatcher = await getContract(
    hub.walletClient,
    hub.publicClient,
    dispatcherArtifact,
    hubDeployment.contracts.crossChainDispatcher
  );

  const encodedMessage = buildContractSmokeMessage(hubApi);
  const weight = await dispatcher.read.estimateEncodedMessageWeight([encodedMessage]);
  const requestId = `0x${Date.now().toString(16).padEnd(64, "0")}`;

  const hash = await dispatcher.write.executeEncodedMessage([requestId, encodedMessage, weight], {
    account: hub.account,
    nonce: await hub.nonceManager.next()
  });
  const receipt = await hub.publicClient.waitForTransactionReceipt({ hash });

  console.log(`Hub contract-origin execute tx: ${receipt.transactionHash}`);
  console.log(`Dispatcher: ${hubDeployment.contracts.crossChainDispatcher}`);
  console.log(`Verified contract-origin XCM precompile smoke execution for request ${requestId}`);

  await hubApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
