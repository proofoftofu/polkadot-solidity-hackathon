import {
  DEFAULT_MOONBASE_PARA_ID,
  buildMoonbeamExecutionMessage,
  buildMoonbeamTransactCall,
  createClients,
  createSubstrateApi,
  encodeVersionedLocation,
  getContract,
  readArtifact,
  readDeployment,
  waitForRemoteExecutionLog,
  writeContract
} from "./common.js";
import { encodeFunctionData, getAddress, stringToHex } from "viem";

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");
  const moonbeamDeployment = await readDeployment("moonbaseAlpha");

  const hub = createClients("polkadotTestnet");
  const moonbeam = createClients("moonbaseAlpha");
  const hubApi = await createSubstrateApi("polkadotTestnet");
  const moonbeamApi = await createSubstrateApi("moonbaseAlpha");

  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const targetArtifact = await readArtifact("mocks/MockTarget.sol", "MockTarget");

  const dispatcher = await getContract(
    hub.walletClient,
    hub.publicClient,
    dispatcherArtifact,
    hubDeployment.contracts.crossChainDispatcher
  );
  const target = await getContract(
    moonbeam.walletClient,
    moonbeam.publicClient,
    targetArtifact,
    moonbeamDeployment.contracts.crossChainTarget
  );

  const memo = stringToHex(`memo-${Date.now()}`, { size: 32 });
  const requestId = stringToHex(`req-${Date.now()}`, { size: 32 });
  const remoteCallData = encodeFunctionData({
    abi: targetArtifact.abi,
    functionName: "recordRemoteExecution",
    args: [requestId, memo]
  });
  const moonbeamEthereumXcmCall = buildMoonbeamTransactCall(
    moonbeamApi,
    moonbeamDeployment.contracts.crossChainTarget,
    remoteCallData
  );
  const encodedMessage = buildMoonbeamExecutionMessage(hubApi, moonbeamEthereumXcmCall);
  const encodedDestination =
    hubDeployment.contracts.moonbeamDestination ??
    encodeVersionedLocation(hubApi, hubDeployment.contracts.moonbaseParaId ?? DEFAULT_MOONBASE_PARA_ID, 1);

  const configuredDestination = await dispatcher.read.destination();
  if (configuredDestination.toLowerCase() !== encodedDestination.toLowerCase()) {
    throw new Error(
      `Dispatcher destination mismatch. Expected ${encodedDestination}, got ${configuredDestination}. Re-deploy or call setDestination first.`
    );
  }

  const weight = await dispatcher.read.estimateEncodedMessageWeight([encodedMessage]);
  console.log(`Estimated Hub XCM weight: refTime=${weight.refTime} proofSize=${weight.proofSize}`);

  const fromBlock = await moonbeam.publicClient.getBlockNumber();
  const hubReceipt = await writeContract(
    dispatcher.write.dispatchEncodedMessage,
    [moonbeamDeployment.contracts.crossChainTarget, requestId, encodedMessage],
    hub.publicClient,
    hub.nonceManager
  );
  console.log(`Hub dispatch tx: ${hubReceipt.transactionHash}`);

  const remoteLog = await waitForRemoteExecutionLog(
    moonbeam.publicClient,
    moonbeamDeployment.contracts.crossChainTarget,
    requestId,
    fromBlock
  );

  const lastMemo = await target.read.lastMemo();
  const lastRequestId = await target.read.lastRequestId();
  const lastCaller = await target.read.lastCaller();
  if (lastMemo !== memo || lastRequestId !== requestId) {
    throw new Error(`Moonbeam target state mismatch. Expected request ${requestId} and memo ${memo}.`);
  }

  console.log(`Moonbeam target tx: ${remoteLog.transactionHash}`);
  console.log(`Moonbeam target caller: ${lastCaller}`);
  console.log(`Verified real Hub -> Moonbeam XCM smoke flow for request ${requestId}`);
  console.log(`Dispatcher: ${getAddress(hubDeployment.contracts.crossChainDispatcher)}`);
  console.log(`Target: ${getAddress(moonbeamDeployment.contracts.crossChainTarget)}`);

  await hubApi.disconnect();
  await moonbeamApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
