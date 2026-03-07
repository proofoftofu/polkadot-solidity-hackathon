import {
  createClients,
  createSubstrateApi,
  getContract,
  readArtifact,
  readDeployment,
  sendNative
} from "./common.js";

import { blake2AsU8a } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";

function evmToSubstrateAccount(address) {
  return u8aToHex(
    blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256)
  );
}

async function readFreeBalance(api, accountId32) {
  const account = await api.query.system.account(accountId32);
  return account.data.free.toString();
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
    hub.nonceManager,
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

  const dispatcherAddress = hubDeployment.contracts.crossChainDispatcher;
  const dispatcherDerived = evmToSubstrateAccount(dispatcherAddress);
  const ownerDerived = evmToSubstrateAccount(hub.account.address);
  const minimumDispatcherEvmBalance = 10n ** 18n;
  const encodedMessage =
    process.env.XCM_TEST_MESSAGE
    ?? "0x050c00040100000700e40b54023001000002286bee31010100a90f0100000401000002286bee000400010204040d010204000101008eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";

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
  console.log("dispatcherEvmBalance", dispatcherEvmBalance.toString());
  console.log("ownerEvmBalance", ownerEvmBalance.toString());
  console.log("dispatcherDerivedFreeBalance", await readFreeBalance(hubApi, dispatcherDerived));
  console.log("ownerDerivedFreeBalance", await readFreeBalance(hubApi, ownerDerived));
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
      account: hub.account,
      nonce: await hub.nonceManager.next()
    });
    const receipt = await hub.publicClient.waitForTransactionReceipt({ hash });

    console.log(`Hub contract-origin execute tx: ${receipt.transactionHash}`);
    console.log(`Dispatcher: ${dispatcherAddress}`);
    console.log(`Verified contract-origin XCM precompile smoke execution for request ${requestId}`);
  } catch (error) {
    console.error("contractExecuteError", error);
    process.exitCode = 1;
  }

  await hubApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
