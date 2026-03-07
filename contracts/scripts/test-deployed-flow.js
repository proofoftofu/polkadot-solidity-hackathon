import {
  buildPeopleChainTeleportMessage,
  createClients,
  createSubstrateApi,
  getContract,
  readArtifact,
  readDeployment,
  sendNative
} from "./common.js";

import { blake2AsU8a, encodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";

function evmToSubstrateAccount(address) {
  return u8aToHex(
    blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256)
  );
}

async function readFreeBalance(api, accountId32) {
  const account = await api.query.system.account(accountId32);
  return BigInt(account.data.free.toString());
}

async function ensureDispatcherEvmBalance(hub, dispatcherAddress, minBalance) {
  const currentBalance = await hub.publicClient.getBalance({ address: dispatcherAddress });
  if (currentBalance >= minBalance) {
    return currentBalance;
  }

  const topUp = minBalance - currentBalance;
  const receipt = await sendNative(
    hub.walletClient,
    hub.publicClient,
    undefined,
    dispatcherAddress,
    topUp
  );

  console.log(`dispatcherTopUpTx ${receipt.transactionHash}`);
  return hub.publicClient.getBalance({ address: dispatcherAddress });
}

function summarizeDryRun(result) {
  const json = result.toJSON();
  if (json.ok?.executionResult?.complete) {
    return {
      status: "complete",
      used: json.ok.executionResult.complete.used,
      forwardedXcms: json.ok.forwardedXcms?.length ?? 0
    };
  }
  if (json.ok?.executionResult?.incomplete) {
    return {
      status: "incomplete",
      error: json.ok.executionResult.incomplete.error,
      forwardedXcms: json.ok.forwardedXcms?.length ?? 0
    };
  }
  return json;
}

async function waitForDestinationIncrease(api, beneficiary, beforeBalance) {
  const attempts = Number.parseInt(process.env.XCM_DESTINATION_POLL_ATTEMPTS ?? "24", 10);
  const delayMs = Number.parseInt(process.env.XCM_DESTINATION_POLL_DELAY_MS ?? "5000", 10);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const current = await readFreeBalance(api, beneficiary);
    console.log(`destinationPoll attempt=${attempt} balance=${current.toString()}`);
    if (current > beforeBalance) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return readFreeBalance(api, beneficiary);
}

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");

  const hub = createClients("polkadotTestnet");
  const hubApi = await createSubstrateApi("polkadotTestnet");
  const peopleApi = await createSubstrateApi("peoplePaseo");

  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const dispatcher = await getContract(
    hub.walletClient,
    hub.publicClient,
    dispatcherArtifact,
    hubDeployment.contracts.crossChainDispatcher
  );

  const dispatcherAddress = hubDeployment.contracts.crossChainDispatcher;
  const dispatcherDerived = evmToSubstrateAccount(dispatcherAddress);
  const ownerDerived = evmToSubstrateAccount(hub.account.address);
  const minimumDispatcherEvmBalance = BigInt(
    process.env.XCM_MIN_DISPATCHER_EVM_BALANCE ?? "1000000000000000000"
  );
  const paraId = Number.parseInt(process.env.XCM_DESTINATION_PARA_ID ?? "1004", 10);
  const beneficiary =
    process.env.XCM_TEST_BENEFICIARY
    ?? "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";
  const transferAmount = BigInt(process.env.XCM_TRANSFER_AMOUNT ?? "10000000000");
  const localFee = BigInt(process.env.XCM_LOCAL_FEE_AMOUNT ?? "1000000000");
  const remoteFee = BigInt(process.env.XCM_REMOTE_FEE_AMOUNT ?? "1000000000");
  const encodedMessage =
    process.env.XCM_TEST_MESSAGE
    ?? buildPeopleChainTeleportMessage(hubApi, paraId, beneficiary, {
      amount: transferAmount,
      localFee,
      remoteFee
    });

  const dispatcherEvmBalance = await ensureDispatcherEvmBalance(
    hub,
    dispatcherAddress,
    minimumDispatcherEvmBalance
  );
  const ownerEvmBalance = await hub.publicClient.getBalance({ address: hub.account.address });

  console.log("dispatcher", dispatcherAddress);
  console.log("dispatcherDerivedAccountId32", dispatcherDerived);
  console.log("ownerEvmAddress", hub.account.address);
  console.log("ownerDerivedAccountId32", ownerDerived);
  console.log("destinationParaId", paraId);
  console.log("beneficiaryAccountId32", beneficiary);
  console.log("beneficiarySs58", encodeAddress(beneficiary, 0));
  console.log("transferAmount", transferAmount.toString());
  console.log("localFee", localFee.toString());
  console.log("remoteFee", remoteFee.toString());
  console.log("dispatcherEvmBalance", dispatcherEvmBalance.toString());
  console.log("ownerEvmBalance", ownerEvmBalance.toString());
  console.log("dispatcherDerivedFreeBalance", (await readFreeBalance(hubApi, dispatcherDerived)).toString());
  console.log("ownerDerivedFreeBalance", (await readFreeBalance(hubApi, ownerDerived)).toString());
  const destinationBefore = await readFreeBalance(peopleApi, beneficiary);
  console.log("destinationBeneficiaryBalanceBefore", destinationBefore.toString());
  console.log("encodedMessage", encodedMessage);

  const ownerAccountKey20Origin = {
    V5: {
      parents: 0,
      interior: {
        X1: [{ AccountKey20: { network: null, key: hub.account.address } }]
      }
    }
  };
  const dispatcherAccountId32Origin = {
    V5: {
      parents: 0,
      interior: {
        X1: [{ AccountId32: { network: null, id: dispatcherDerived } }]
      }
    }
  };
  const ownerAccountId32Origin = {
    V5: {
      parents: 0,
      interior: {
        X1: [{ AccountId32: { network: null, id: ownerDerived } }]
      }
    }
  };
  
  console.log(
    "dryRun owner AccountKey20",
    JSON.stringify(
      summarizeDryRun(await hubApi.call.dryRunApi.dryRunXcm(ownerAccountKey20Origin, encodedMessage)),
      null,
      2
    )
  );
  console.log(
    "dryRun owner derived AccountId32",
    JSON.stringify(
      summarizeDryRun(await hubApi.call.dryRunApi.dryRunXcm(ownerAccountId32Origin, encodedMessage)),
      null,
      2
    )
  );
  console.log(
    "dryRun dispatcher derived AccountId32",
    JSON.stringify(
      summarizeDryRun(await hubApi.call.dryRunApi.dryRunXcm(dispatcherAccountId32Origin, encodedMessage)),
      null,
      2
    )
  );

  const weight = await dispatcher.read.estimateEncodedMessageWeight([encodedMessage]);
  console.log("weight", weight);

  const requestId = `0x${Date.now().toString(16).padEnd(64, "0")}`;

  try {
    const hash = await dispatcher.write.executeEncodedMessage([requestId, encodedMessage, weight], {
      account: hub.account
    });
    console.log(`Hub contract-origin execute tx: ${hash}`);
    const receipt = await hub.publicClient.waitForTransactionReceipt({ hash });
    const destinationAfter = await waitForDestinationIncrease(peopleApi, beneficiary, destinationBefore);

    console.log(`Hub contract-origin execute receipt: ${receipt.transactionHash}`);
    console.log(`Dispatcher: ${dispatcherAddress}`);
    console.log(`destinationBeneficiaryBalanceAfter ${destinationAfter.toString()}`);
    console.log(`destinationBalanceDelta ${(destinationAfter - destinationBefore).toString()}`);
    if (destinationAfter <= destinationBefore) {
      throw new Error("Destination beneficiary balance did not increase within the polling window.");
    }
    console.log(`Verified contract-origin XCM precompile smoke execution for request ${requestId}`);
  } catch (error) {
    console.error("contractExecuteError", error);
    process.exitCode = 1;
  }

  await hubApi.disconnect();
  await peopleApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
