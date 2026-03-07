import {
  createClients,
  getContract,
  readArtifact,
  readDeployment
} from "./common.js";
import { decodeAbiParameters, encodeFunctionData, getAddress, parseAbiParameters, stringToHex } from "viem";

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");
  const moonbeamDeployment = await readDeployment("moonbaseAlpha");

  const hub = createClients("polkadotTestnet");
  const moonbeam = createClients("moonbaseAlpha");

  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const receiverArtifact = await readArtifact("CrossChainReceiver.sol", "CrossChainReceiver");
  const targetArtifact = await readArtifact("mocks/MockTarget.sol", "MockTarget");

  const dispatcher = await getContract(hub.walletClient, dispatcherArtifact, hubDeployment.contracts.crossChainDispatcher);
  const receiver = await getContract(
    moonbeam.walletClient,
    receiverArtifact,
    moonbeamDeployment.contracts.crossChainReceiver
  );
  const target = await getContract(
    moonbeam.walletClient,
    targetArtifact,
    moonbeamDeployment.contracts.crossChainTarget
  );

  const memo = stringToHex(`memo-${Date.now()}`, { size: 32 });
  const requestId = stringToHex(`req-${Date.now()}`, { size: 32 });
  const remoteCall = {
    destinationChainId: BigInt(hubDeployment.contracts.moonbeamDestination ? 1287 : moonbeamDeployment.chainId),
    receiver: moonbeamDeployment.contracts.crossChainReceiver,
    target: moonbeamDeployment.contracts.crossChainTarget,
    value: 0n,
    callData: encodeFunctionData({
      abi: targetArtifact.abi,
      functionName: "recordMemo",
      args: [memo]
    }),
    requestId
  };

  const weight = await dispatcher.read.estimateDispatchWeight([remoteCall]);
  console.log(`Estimated Hub XCM weight: refTime=${weight.refTime} proofSize=${weight.proofSize}`);

  const hubTx = await dispatcher.write.dispatchRemoteCall([remoteCall]);
  const hubReceipt = await hub.publicClient.waitForTransactionReceipt({ hash: hubTx });
  console.log(`Hub dispatch tx: ${hubReceipt.transactionHash}`);

  const manualRelay = (process.env.MOONBEAM_EXECUTION_MODE ?? "manual-relay") === "manual-relay";
  if (!manualRelay) {
    console.log("Skipping Moonbeam execution. Set MOONBEAM_EXECUTION_MODE=manual-relay to complete the smoke test.");
    return;
  }

  const relayTx = await receiver.write.receiveCrossChainCall([
    hubDeployment.contracts.crossChainDispatcher,
    moonbeamDeployment.contracts.crossChainTarget,
    0n,
    remoteCall.callData,
    requestId
  ]);
  const relayReceipt = await moonbeam.publicClient.waitForTransactionReceipt({ hash: relayTx });
  console.log(`Moonbeam relay tx: ${relayReceipt.transactionHash}`);

  const lastMemo = await target.read.lastMemo();
  if (lastMemo !== memo) {
    throw new Error(`Moonbeam target memo mismatch. Expected ${memo}, got ${lastMemo}`);
  }

  const executed = await receiver.read.executedRequests([requestId]);
  if (!executed) {
    throw new Error("Receiver did not mark the request as executed.");
  }

  const [decodedMemo] = decodeAbiParameters(parseAbiParameters("bytes32"), remoteCall.callData.slice(10));
  console.log(`Verified Hub -> Moonbeam smoke flow for request ${requestId} and memo ${decodedMemo}`);
  console.log(`Dispatcher: ${getAddress(hubDeployment.contracts.crossChainDispatcher)}`);
  console.log(`Receiver: ${getAddress(moonbeamDeployment.contracts.crossChainReceiver)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
