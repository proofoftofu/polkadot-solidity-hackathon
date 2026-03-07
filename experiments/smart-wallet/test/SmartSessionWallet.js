import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  padHex,
  parseEther,
  stringToHex,
  toHex,
  zeroHash
} from "viem";

const BASE_MODE = zeroHash;
const ERC1271_MAGIC_VALUE = "0x1626ba7e";

function encodeSingleExecution(target, value, callData) {
  return `${target.toLowerCase()}${padHex(toHex(value), { size: 32 }).slice(2)}${callData.slice(2)}`;
}

function sessionInitData(agent, tradeExecutor, expiresAt, sponsorshipRequired = true) {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "bytes4" },
      { type: "uint64" },
      { type: "uint32" },
      { type: "uint128" },
      { type: "bool" }
    ],
    [
      agent.account.address,
      tradeExecutor.address,
      "0x62f4b543",
      BigInt(expiresAt),
      2,
      parseEther("1"),
      sponsorshipRequired
    ]
  );
}

async function buildSignedUserOp({ entryPoint, wallet, validator, agent, executionCalldata, paymaster, nonce = 0n }) {
  const callData = encodeFunctionData({
    abi: wallet.abi,
    functionName: "execute",
    args: [BASE_MODE, executionCalldata]
  });

  const userOp = {
    sender: wallet.address,
    nonce,
    initCode: "0x",
    callData,
    accountGasLimits: zeroHash,
    preVerificationGas: 0n,
    gasFees: zeroHash,
    paymasterAndData:
      paymaster === undefined
        ? "0x"
        : encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [paymaster.address, 1_000_000_000_000_000n]),
    signature: "0x"
  };

  const userOpHash = await entryPoint.read.getUserOpHash([userOp]);
  const sessionSignature = await agent.signMessage({ message: { raw: userOpHash } });

  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [
      validator.address,
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [agent.account.address, sessionSignature])
    ]
  );

  return { userOp, userOpHash };
}

describe("SmartSessionWallet", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  async function deployFixture() {
    const [deployer, owner, sponsor, agent] = await viem.getWalletClients();
    const tradeExecutor = await viem.deployContract("MockTradeExecutor", [], {
      client: { wallet: deployer }
    });
    const entryPoint = await viem.deployContract("MockEntryPoint", [], {
      client: { wallet: deployer }
    });
    const wallet = await viem.deployContract(
      "SmartSessionWallet",
      [owner.account.address, entryPoint.address],
      { client: { wallet: deployer } }
    );
    const validator = await viem.deployContract("SessionKeyValidatorModule", [], {
      client: { wallet: deployer }
    });
    const executor = await viem.deployContract("MockExecutorModule", [], {
      client: { wallet: deployer }
    });
    const paymaster = await viem.deployContract(
      "SimplePaymaster",
      [sponsor.account.address, entryPoint.address],
      { client: { wallet: deployer } }
    );

    return { owner, sponsor, agent, tradeExecutor, entryPoint, wallet, validator, executor, paymaster };
  }

  it("implements ERC-7579 account config and module installation", async function () {
    const { owner, agent, tradeExecutor, wallet, validator, executor } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await viem.assertions.emitWithArgs(
      wallet.write.installModule([1n, validator.address, sessionInitData(agent, tradeExecutor, expiresAt)], {
        account: owner.account
      }),
      wallet,
      "ModuleInstalled",
      [1n, getAddress(validator.address)]
    );

    await viem.assertions.emitWithArgs(
      wallet.write.installModule([2n, executor.address, "0x"], { account: owner.account }),
      wallet,
      "ModuleInstalled",
      [2n, getAddress(executor.address)]
    );

    assert.equal(await wallet.read.accountId(), "tofu.smart-session-wallet.erc7579.v1");
    assert.equal(await wallet.read.supportsModule([1n]), true);
    assert.equal(await wallet.read.supportsModule([2n]), true);
    assert.equal(await wallet.read.supportsExecutionMode([BASE_MODE]), true);
    assert.equal(await wallet.read.isModuleInstalled([1n, validator.address, "0x"]), true);
    assert.equal(await wallet.read.isModuleInstalled([2n, executor.address, "0x"]), true);
  });

  it("executes a sponsored user operation through handleOps, validateUserOp, and paymaster validation", async function () {
    const { owner, sponsor, agent, tradeExecutor, entryPoint, wallet, validator, paymaster } =
      await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule([1n, validator.address, sessionInitData(agent, tradeExecutor, expiresAt)], {
      account: owner.account
    });
    await paymaster.write.setAccountAllowance([wallet.address, true], {
      account: sponsor.account
    });
    await paymaster.write.deposit([], {
      account: sponsor.account,
      value: parseEther("0.5")
    });

    const executionCalldata = encodeSingleExecution(
      tradeExecutor.address,
      0n,
      encodeFunctionData({
        abi: tradeExecutor.abi,
        functionName: "swapExactInput",
        args: [100n]
      })
    );
    const { userOp, userOpHash } = await buildSignedUserOp({
      entryPoint,
      wallet,
      validator,
      agent,
      executionCalldata,
      paymaster
    });

    await viem.assertions.emitWithArgs(
      entryPoint.write.handleOps([[userOp]]),
      wallet,
      "UserOperationExecuted",
      [userOpHash, getAddress(validator.address)]
    );

    assert.equal(await tradeExecutor.read.totalAmountIn(), 100n);
    assert.equal(await wallet.read.nonce(), 1n);
    assert.equal(await paymaster.read.sponsorBudget(), parseEther("0.499"));
  });

  it("forwards ERC-1271 validation to the installed validator module", async function () {
    const { owner, agent, tradeExecutor, wallet, validator } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule([1n, validator.address, sessionInitData(agent, tradeExecutor, expiresAt)], {
      account: owner.account
    });

    const hash = keccak256(stringToHex("session-signature-check"));
    const signature = await agent.signMessage({ message: { raw: hash } });
    const encodedSignature = encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }],
      [
        validator.address,
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes" }],
          [agent.account.address, signature]
        )
      ]
    );

    assert.equal(await wallet.read.isValidSignature([hash, encodedSignature]), ERC1271_MAGIC_VALUE);
  });

  it("rejects session execution outside the allowed selector", async function () {
    const { owner, agent, tradeExecutor, wallet, validator } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule([1n, validator.address, sessionInitData(agent, tradeExecutor, expiresAt, false)], {
      account: owner.account
    });

    const executionCalldata = encodeSingleExecution(
      tradeExecutor.address,
      0n,
      encodeFunctionData({
        abi: tradeExecutor.abi,
        functionName: "sweep",
        args: [owner.account.address]
      })
    );

    await viem.assertions.revertWithCustomError(
      validator.write.executeSession([wallet.address, BASE_MODE, executionCalldata], {
        account: agent.account
      }),
      validator,
      "UnauthorizedAction"
    );
  });

  it("executes through executeFromExecutor for installed executor modules", async function () {
    const { owner, tradeExecutor, wallet, executor } = await deployFixture();

    await wallet.write.installModule([2n, executor.address, "0x"], { account: owner.account });

    const executionCalldata = encodeSingleExecution(
      tradeExecutor.address,
      0n,
      encodeFunctionData({
        abi: tradeExecutor.abi,
        functionName: "swapExactInput",
        args: [55n]
      })
    );

    const result = await executor.write.executeViaAccount([wallet.address, BASE_MODE, executionCalldata], {
      account: owner.account
    });
    await publicClient.waitForTransactionReceipt({ hash: result });

    assert.equal(await tradeExecutor.read.totalAmountIn(), 55n);
  });

  it("rejects a replayed user operation nonce through the entry point flow", async function () {
    const { owner, sponsor, agent, tradeExecutor, entryPoint, wallet, validator, paymaster } =
      await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule([1n, validator.address, sessionInitData(agent, tradeExecutor, expiresAt)], {
      account: owner.account
    });
    await paymaster.write.setAccountAllowance([wallet.address, true], {
      account: sponsor.account
    });
    await paymaster.write.deposit([], {
      account: sponsor.account,
      value: parseEther("0.5")
    });

    const executionCalldata = encodeSingleExecution(
      tradeExecutor.address,
      0n,
      encodeFunctionData({
        abi: tradeExecutor.abi,
        functionName: "swapExactInput",
        args: [100n]
      })
    );

    const first = await buildSignedUserOp({
      entryPoint,
      wallet,
      validator,
      agent,
      executionCalldata,
      paymaster,
      nonce: 0n
    });

    await entryPoint.write.handleOps([[first.userOp]]);

    const replay = await buildSignedUserOp({
      entryPoint,
      wallet,
      validator,
      agent,
      executionCalldata,
      paymaster,
      nonce: 0n
    });

    await viem.assertions.revertWithCustomError(
      entryPoint.write.handleOps([[replay.userOp]]),
      wallet,
      "InvalidUserOpNonce"
    );
  });

  it("uninstalls the validator module and blocks future sponsored user operations", async function () {
    const { owner, sponsor, agent, tradeExecutor, entryPoint, wallet, validator, paymaster } =
      await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule([1n, validator.address, sessionInitData(agent, tradeExecutor, expiresAt)], {
      account: owner.account
    });
    await paymaster.write.setAccountAllowance([wallet.address, true], {
      account: sponsor.account
    });
    await paymaster.write.deposit([], {
      account: sponsor.account,
      value: parseEther("0.5")
    });
    await wallet.write.uninstallModule([1n, validator.address, "0x"], { account: owner.account });

    const executionCalldata = encodeSingleExecution(
      tradeExecutor.address,
      0n,
      encodeFunctionData({
        abi: tradeExecutor.abi,
        functionName: "swapExactInput",
        args: [100n]
      })
    );
    const { userOp } = await buildSignedUserOp({
      entryPoint,
      wallet,
      validator,
      agent,
      executionCalldata,
      paymaster
    });

    await viem.assertions.revertWithCustomError(
      entryPoint.write.handleOps([[userOp]]),
      wallet,
      "InvalidValidatorSelection"
    );
  });
});
