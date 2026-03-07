import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, parseAbiParameters, stringToHex } from "viem";
import { deployFromArtifact, getContract, readArtifact } from "../scripts/common.js";

const DESTINATION = encodeAbiParameters(
  parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
  [1, 2004, "0x1111111111111111111111111111111111111111"]
);
const RAW_MESSAGE = stringToHex("hub-wallet-xcm");

describe("CrossChainDispatcher", async function () {
  const { viem } = await network.connect();

  async function deployFixture() {
    const [deployer] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const routerArtifact = await readArtifact("mocks/MockMoonbeamXcmRouter.sol", "MockMoonbeamXcmRouter");
    const xcmPrecompileArtifact = await readArtifact("mocks/MockXcmPrecompile.sol", "MockXcmPrecompile");
    const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");

    const routerAddress = await deployFromArtifact(
      deployer,
      publicClient,
      routerArtifact,
      [DESTINATION]
    );
    const xcmPrecompileAddress = await deployFromArtifact(
      deployer,
      publicClient,
      xcmPrecompileArtifact,
      [routerAddress]
    );
    const dispatcherAddress = await deployFromArtifact(
      deployer,
      publicClient,
      dispatcherArtifact,
      [deployer.account.address, xcmPrecompileAddress]
    );

    const router = await getContract(deployer, publicClient, routerArtifact, routerAddress);
    const xcmPrecompile = await getContract(deployer, publicClient, xcmPrecompileArtifact, xcmPrecompileAddress);
    const dispatcher = await getContract(deployer, publicClient, dispatcherArtifact, dispatcherAddress);

    return { deployer, router, xcmPrecompile, dispatcher };
  }

  it("sends a raw XCM message through the precompile-compatible path", async function () {
    const { dispatcher, router } = await deployFixture();
    const requestId = stringToHex("req-1", { size: 32 });
    await dispatcher.write.dispatchEncodedMessage([requestId, DESTINATION, RAW_MESSAGE]);
    const events = await router.getEvents.XcmDelivered();

    assert.equal(events.length > 0, true);
    assert.equal(events[0].args.payload, RAW_MESSAGE);
    assert.equal(events[0].args.destination, DESTINATION);
  });

  it("executes a raw encoded XCM program through the precompile", async function () {
    const { deployer, xcmPrecompile, dispatcher } = await deployFixture();
    const requestId = stringToHex("req-exec", { size: 32 });
    const encodedMessage = stringToHex("people-chain-teleport");
    const weight = await dispatcher.read.estimateEncodedMessageWeight([encodedMessage]);

    await dispatcher.write.executeEncodedMessage([requestId, encodedMessage, weight], { account: deployer.account });
    assert.equal((await xcmPrecompile.getEvents.XcmExecuted()).length > 0, true);
  });
});
