import {
  buildMoonbeamExecutionMessage,
  buildMoonbeamTransactCall,
  createClients,
  createSubstrateApi,
  deriveSiblingSovereignAccount,
  dryRunMoonbeamExecutionMessage,
  encodeVersionedLocation,
  ensureMoonbeamSovereignBalance,
  estimateMoonbeamTransactWeight,
  getContract,
  getHubParaId,
  readArtifact,
  readDeployment,
  updateAddressesIndex,
  waitForRemoteExecutionLog,
  writeDeployment,
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
  const hubParaId = await getHubParaId(hubApi);
  const moonbaseParaId = await getHubParaId(moonbeamApi);
  const hubSovereignAccount = deriveSiblingSovereignAccount(hubParaId);
  const remoteCallData = encodeFunctionData({
    abi: targetArtifact.abi,
    functionName: "recordRemoteExecution",
    args: [requestId, memo]
  });
  const requireWeightAtMost = await estimateMoonbeamTransactWeight(
    moonbeamApi,
    moonbeam.account.address,
    moonbeamDeployment.contracts.crossChainTarget,
    remoteCallData
  );
  const moonbeamEthereumXcmCall = buildMoonbeamTransactCall(
    moonbeamApi,
    moonbeamDeployment.contracts.crossChainTarget,
    remoteCallData
  );
  const encodedMessage = buildMoonbeamExecutionMessage(hubApi, moonbeamEthereumXcmCall, {
    requireWeightAtMost
  });
  const encodedDestination = encodeVersionedLocation(
    hubApi,
    moonbaseParaId,
    1
  );

  const configuredDestination = await dispatcher.read.destination();
  if (configuredDestination.toLowerCase() !== encodedDestination.toLowerCase()) {
    console.log(`Updating dispatcher destination from ${configuredDestination} to ${encodedDestination}`);
    await writeContract(dispatcher.write.setDestination, [encodedDestination], hub.publicClient, hub.nonceManager);
    hubDeployment.contracts.moonbeamDestination = encodedDestination;
    hubDeployment.contracts.moonbaseParaId = moonbaseParaId;
    await writeDeployment("polkadotTestnet", hubDeployment);
    await updateAddressesIndex("polkadotTestnet", hubDeployment);
  }

  const funding = await ensureMoonbeamSovereignBalance(moonbeam, hubSovereignAccount);
  if (funding.funded) {
    console.log(`Funded Hub sovereign account on Moonbase: ${hubSovereignAccount}`);
  }
  console.log(`Moonbase Hub sovereign balance: ${funding.balance}`);

  const dryRun = await dryRunMoonbeamExecutionMessage(moonbeamApi, hubParaId, encodedMessage);
  const executionResult = dryRun?.ok?.executionResult ?? dryRun?.executionResult;
  if (!executionResult || executionResult.incomplete || executionResult.error) {
    throw new Error(`Moonbase dry-run failed for Hub message: ${JSON.stringify(dryRun)}`);
  }

  try {
    const weight = await dispatcher.read.estimateEncodedMessageWeight([encodedMessage]);
    console.log(`Estimated Hub XCM weight: refTime=${weight.refTime} proofSize=${weight.proofSize}`);
  } catch (error) {
    console.log("Weight estimation failed on the Hub precompile. Continuing with send() because XCM send does not require a weight parameter.");
    if (error instanceof Error) {
      console.log(error.message);
    }
  }

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
