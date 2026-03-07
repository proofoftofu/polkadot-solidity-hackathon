import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbiParameters, stringToHex } from "viem";

const DESTINATION = encodeAbiParameters(
  parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
  [1, 2004, "0x1111111111111111111111111111111111111111"]
);
const PREFIX = stringToHex("TOFU_XCM_V1");

describe("CrossChainDispatcher", async function () {
  const { viem } = await network.connect();

  async function deployFixture() {
    const [deployer] = await viem.getWalletClients();
    const router = await viem.deployContract("MockMoonbeamXcmRouter", [DESTINATION, PREFIX], {
      client: { wallet: deployer }
    });
    const xcmPrecompile = await viem.deployContract("MockXcmPrecompile", [router.address], {
      client: { wallet: deployer }
    });
    const dispatcher = await viem.deployContract(
      "CrossChainDispatcher",
      [deployer.account.address, xcmPrecompile.address, 1287n, DESTINATION],
      { client: { wallet: deployer } }
    );
    const target = await viem.deployContract("MockTarget", [], { client: { wallet: deployer } });
    const receiver = await viem.deployContract("CrossChainReceiver", [router.address, dispatcher.address], {
      client: { wallet: deployer }
    });

    await dispatcher.write.setMessagePrefix([PREFIX], { account: deployer.account });
    await dispatcher.write.setAllowedReceiver([receiver.address, true], { account: deployer.account });

    return { deployer, router, xcmPrecompile, dispatcher, receiver, target };
  }

  it("routes a hub dispatch through the XCM precompile-compatible path", async function () {
    const { dispatcher, receiver, target } = await deployFixture();
    const requestId = stringToHex("req-1", { size: 32 });
    const memo = stringToHex("moonbeam", { size: 32 });
    const remoteCall = {
      destinationChainId: 1287n,
      receiver: receiver.address,
      target: target.address,
      value: 0n,
      callData: encodeFunctionData({
        abi: target.abi,
        functionName: "recordMemo",
        args: [memo]
      }),
      requestId
    };

    const weight = await dispatcher.read.estimateDispatchWeight([remoteCall]);
    assert.equal(weight.proofSize > 0n, true);

    await viem.assertions.emitWithArgs(
      dispatcher.write.dispatchRemoteCall([remoteCall]),
      receiver,
      "CrossChainCallExecuted",
      [getAddress(dispatcher.address), getAddress(target.address), requestId, 0n]
    );

    assert.equal(await target.read.lastMemo(), memo);
    assert.equal(await receiver.read.executedRequests([requestId]), true);
  });

  it("rejects unsupported receivers and direct calls on the Moonbeam-side receiver", async function () {
    const { deployer, dispatcher, receiver, target } = await deployFixture();
    const requestId = stringToHex("req-2", { size: 32 });

    await viem.assertions.revertWithCustomError(
      dispatcher.write.dispatchRemoteCall([
        {
          destinationChainId: 1287n,
          receiver: target.address,
          target: target.address,
          value: 0n,
          callData: encodeFunctionData({
            abi: target.abi,
            functionName: "recordMemo",
            args: [stringToHex("bad", { size: 32 })]
          }),
          requestId
        }
      ]),
      dispatcher,
      "UnsupportedReceiver"
    );

    await viem.assertions.revertWithCustomError(
      receiver.write.receiveCrossChainCall(
        [dispatcher.address, target.address, 0n, encodeFunctionData({
          abi: target.abi,
          functionName: "recordMemo",
          args: [stringToHex("direct", { size: 32 })]
        }), requestId],
        { account: deployer.account }
      ),
      receiver,
      "OnlyRelayer"
    );
  });
});
