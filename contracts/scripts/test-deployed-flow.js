import {
  beneficiarySs58,
  buildPeopleChainTeleportMessage,
  createClients,
  createSubstrateApi,
  readDeployment,
  readSystemFreeBalance,
  waitForSystemFreeBalanceIncrease,
  XCM_PRECOMPILE
} from "./common.js";
import { getContract } from "viem";

async function main() {
  const hubDeployment = await readDeployment("polkadotTestnet");
  const peopleDeployment = await readDeployment("peoplePaseo");

  const hub = createClients("polkadotTestnet");
  const hubApi = await createSubstrateApi("polkadotTestnet");
  const peopleApi = await createSubstrateApi("peoplePaseo");
  const xcm = getContract({
    address: XCM_PRECOMPILE,
    abi: [
      {
        type: "function",
        name: "weighMessage",
        stateMutability: "view",
        inputs: [{ name: "message", type: "bytes" }],
        outputs: [{
          name: "weight",
          type: "tuple",
          components: [
            { name: "refTime", type: "uint64" },
            { name: "proofSize", type: "uint64" }
          ]
        }]
      },
      {
        type: "function",
        name: "execute",
        stateMutability: "nonpayable",
        inputs: [
          { name: "message", type: "bytes" },
          {
            name: "weight",
            type: "tuple",
            components: [
              { name: "refTime", type: "uint64" },
              { name: "proofSize", type: "uint64" }
            ]
          }
        ],
        outputs: []
      }
    ],
    client: {
      public: hub.publicClient,
      wallet: hub.walletClient
    }
  });

  const requestId = `0x${Date.now().toString(16).padEnd(64, "0")}`;
  const beneficiary = peopleDeployment.beneficiary;
  const initialBalance = await readSystemFreeBalance(peopleApi, beneficiary);
  const encodedMessage = buildPeopleChainTeleportMessage(hubApi, peopleDeployment.paraId, beneficiary);

  const weight = await xcm.read.weighMessage([encodedMessage]);
  console.log(`Estimated Hub XCM weight: refTime=${weight.refTime} proofSize=${weight.proofSize}`);

  const hash = await xcm.write.execute([encodedMessage, weight], {
    account: hub.account,
    nonce: await hub.nonceManager.next()
  });
  const hubReceipt = await hub.publicClient.waitForTransactionReceipt({ hash });
  console.log(`Hub execute tx: ${hubReceipt.transactionHash}`);

  const finalBalance = await waitForSystemFreeBalanceIncrease(peopleApi, beneficiary, initialBalance);
  console.log(`People Chain beneficiary: ${beneficiarySs58(beneficiary, 0)}`);
  console.log(`People Chain initial balance: ${initialBalance}`);
  console.log(`People Chain final balance: ${finalBalance}`);
  console.log(`Verified Hub -> People Chain XCM transfer for request ${requestId}`);

  await hubApi.disconnect();
  await peopleApi.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
