import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbiParameters, stringToHex } from "viem";

const MOONBEAM_DESTINATION = encodeAbiParameters(
  parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
  [1, 2004, "0x1111111111111111111111111111111111111111"]
);

describe("cross-chain hub-to-moonbeam experiment", async function () {
  const { viem } = await network.connect();

  async function deployFixture() {
    const [deployer] = await viem.getWalletClients();

    const router = await viem.deployContract("MockMoonbeamXcmRouter", [MOONBEAM_DESTINATION], {
      client: { wallet: deployer }
    });
    const xcmPrecompile = await viem.deployContract("MockXcmPrecompile", [router.address], {
      client: { wallet: deployer }
    });
    const sender = await viem.deployContract(
      "PolkadotHubXcmSender",
      [xcmPrecompile.address, MOONBEAM_DESTINATION],
      { client: { wallet: deployer } }
    );
    const receiver = await viem.deployContract(
      "MoonbeamRemoteExecutor",
      [router.address, sender.address],
      { client: { wallet: deployer } }
    );

    return { deployer, router, xcmPrecompile, sender, receiver };
  }

  it("sends a message from the hub sender and executes receiver logic on the moonbeam side", async function () {
    const { sender, receiver } = await deployFixture();

    const weight = await sender.read.estimateDispatchWeight([
      receiver.address,
      42n,
      stringToHex("moonbeam", { size: 32 })
    ]);
    assert.equal(weight.proofSize > 0n, true);

    await viem.assertions.emitWithArgs(
      sender.write.dispatchSetValue([receiver.address, 42n, stringToHex("moonbeam", { size: 32 })]),
      receiver,
      "RemoteValueUpdated",
      [getAddress(sender.address), 42n, stringToHex("moonbeam", { size: 32 })]
    );

    assert.equal(await receiver.read.lastHubSender(), getAddress(sender.address));
    assert.equal(await receiver.read.lastValue(), 42n);
    assert.equal(await receiver.read.lastMemo(), stringToHex("moonbeam", { size: 32 }));
    assert.equal(await receiver.read.executionCount(), 1n);
  });

  it("rejects delivery when the destination does not match the configured moonbeam route", async function () {
    const { deployer, xcmPrecompile, receiver, sender } = await deployFixture();

    const wrongDestination = encodeAbiParameters(
      parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
      [1, 9999, "0x1111111111111111111111111111111111111111"]
    );
    const message = encodeAbiParameters(
      parseAbiParameters("address receiver, bytes callData"),
      [
        receiver.address,
        encodeFunctionData({
          abi: receiver.abi,
          functionName: "executeFromHub",
          args: [sender.address, 7n, stringToHex("bad-route", { size: 32 })]
        })
      ]
    );

    await viem.assertions.revertWithCustomError(
      xcmPrecompile.write.send([wrongDestination, message], {
        account: deployer.account
      }),
      await viem.getContractAt("MockMoonbeamXcmRouter", (await receiver.read.router())),
      "InvalidDestination"
    );
  });

  it("rejects direct execution on the moonbeam receiver when it is not routed through XCM", async function () {
    const { deployer, receiver, sender } = await deployFixture();

    await viem.assertions.revertWithCustomError(
      receiver.write.executeFromHub([sender.address, 1n, stringToHex("direct", { size: 32 })], {
        account: deployer.account
      }),
      receiver,
      "OnlyRouter"
    );
  });
});
