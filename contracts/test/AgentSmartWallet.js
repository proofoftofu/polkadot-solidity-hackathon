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
import { deployFromArtifact, getContract, readArtifact } from "../scripts/common.js";

const BASE_MODE = zeroHash;
const ERC1271_MAGIC_VALUE = "0x1626ba7e";

function encodeSingleExecution(target, value, callData) {
  return `${target.toLowerCase()}${padHex(toHex(value), { size: 32 }).slice(2)}${callData.slice(2)}`;
}

function sessionInitData(agent, allowedTarget, selector, expiresAt, chainId, sponsorshipAllowed = true) {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes4" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint32" },
      { type: "uint128" },
      { type: "bool" }
    ],
    [
      agent.account.address,
      stringToHex("agent.execute", { size: 32 }),
      chainId,
      allowedTarget.address,
      selector,
      BigInt(expiresAt),
      0n,
      2,
      parseEther("1"),
      sponsorshipAllowed
    ]
  );
}

async function buildSignedUserOp({
  entryPoint,
  wallet,
  validator,
  agent,
  executionCalldata,
  paymaster,
  nonce = 0n,
  targetChainId
}) {
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
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [userOpHash, stringToHex("agent.execute", { size: 32 }), targetChainId, 0n]
    )
  );
  const sessionSignature = await agent.signMessage({ message: { raw: payloadHash } });

  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [
      validator.address,
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [agent.account.address, sessionSignature])
    ]
  );

  return { userOp, userOpHash };
}

describe("AgentSmartWallet", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  async function deployFixture() {
    const [deployer, owner, sponsor, agent] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const targetArtifact = await readArtifact("mocks/MockTarget.sol", "MockTarget");
    const entryPointArtifact = await readArtifact("mocks/MockEntryPoint.sol", "MockEntryPoint");
    const walletFactoryArtifact = await readArtifact("WalletFactory.sol", "WalletFactory");
    const walletArtifact = await readArtifact("AgentSmartWallet.sol", "AgentSmartWallet");
    const validatorArtifact = await readArtifact("SessionKeyValidatorModule.sol", "SessionKeyValidatorModule");
    const executorArtifact = await readArtifact("ExecutionModule.sol", "ExecutionModule");
    const paymasterArtifact = await readArtifact("SponsoredExecutionPaymaster.sol", "SponsoredExecutionPaymaster");

    const targetAddress = await deployFromArtifact(deployer, publicClient, targetArtifact, []);
    const entryPointAddress = await deployFromArtifact(deployer, publicClient, entryPointArtifact, []);
    const walletFactoryAddress = await deployFromArtifact(
      deployer,
      publicClient,
      walletFactoryArtifact,
      [entryPointAddress]
    );
    const target = await getContract(deployer, publicClient, targetArtifact, targetAddress);
    const entryPoint = await getContract(deployer, publicClient, entryPointArtifact, entryPointAddress);
    const walletFactory = await getContract(deployer, publicClient, walletFactoryArtifact, walletFactoryAddress);
    const predictedWalletAddress = await walletFactory.read.predictWallet([owner.account.address]);
    await walletFactory.write.createWallet([owner.account.address], { account: deployer.account });
    const walletAddress = await walletFactory.read.wallets([owner.account.address]);
    const wallet = await getContract(deployer, publicClient, walletArtifact, walletAddress);
    const validatorAddress = await deployFromArtifact(deployer, publicClient, validatorArtifact, []);
    const executorAddress = await deployFromArtifact(deployer, publicClient, executorArtifact, []);
    const paymasterAddress = await deployFromArtifact(
      deployer,
      publicClient,
      paymasterArtifact,
      [sponsor.account.address, entryPoint.address]
    );
    const validator = await getContract(deployer, publicClient, validatorArtifact, validatorAddress);
    const executor = await getContract(deployer, publicClient, executorArtifact, executorAddress);
    const paymaster = await getContract(deployer, publicClient, paymasterArtifact, paymasterAddress);

    return {
      owner,
      sponsor,
      agent,
      target,
      entryPoint,
      walletFactory,
      wallet,
      predictedWalletAddress,
      validator,
      executor,
      paymaster
    };
  }

  it("deploys through the factory and installs validator and executor modules", async function () {
    const { owner, agent, target, wallet, walletFactory, predictedWalletAddress, validator, executor } =
      await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule(
      [1n, validator.address, sessionInitData(agent, target, "0x62f4b543", expiresAt, chainId)],
      { account: owner.account }
    );
    await wallet.write.installModule([2n, executor.address, "0x"], { account: owner.account });

    assert.equal(await wallet.read.accountId(), "tofu.agent-smart-wallet.erc7579.v1");
    assert.equal(await walletFactory.read.wallets([owner.account.address]), getAddress(wallet.address));
    assert.equal(getAddress(predictedWalletAddress), getAddress(wallet.address));
    assert.equal(await wallet.read.isModuleInstalled([1n, validator.address, "0x"]), true);
    assert.equal(await wallet.read.isModuleInstalled([2n, executor.address, "0x"]), true);
  });

  it("executes a sponsored user operation through the entry point and paymaster", async function () {
    const { owner, sponsor, agent, target, entryPoint, wallet, validator, paymaster } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule(
      [1n, validator.address, sessionInitData(agent, target, "0x62f4b543", expiresAt, chainId)],
      { account: owner.account }
    );
    await paymaster.write.setAccountAllowance([wallet.address, true], { account: sponsor.account });
    await paymaster.write.deposit([], { account: sponsor.account, value: parseEther("0.5") });

    const executionCalldata = encodeSingleExecution(
      target.address,
      0n,
      encodeFunctionData({
        abi: target.abi,
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
      paymaster,
      targetChainId: chainId
    });

    await viem.assertions.emitWithArgs(
      entryPoint.write.handleOps([[userOp]]),
      wallet,
      "UserOperationExecuted",
      [userOpHash, getAddress(validator.address)]
    );

    assert.equal(await target.read.totalAmountIn(), 100n);
    assert.equal(await wallet.read.nonce(), 1n);
  });

  it("forwards ERC-1271 validation to the installed validator module", async function () {
    const { owner, agent, target, wallet, validator } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    await wallet.write.installModule(
      [1n, validator.address, sessionInitData(agent, target, "0x3f0c24c5", expiresAt, chainId)],
      { account: owner.account }
    );

    const hash = keccak256(stringToHex("session-signature-check"));
    const payloadHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
        [hash, stringToHex("agent.execute", { size: 32 }), chainId, 0n]
      )
    );
    const signature = await agent.signMessage({ message: { raw: payloadHash } });
    const encodedSignature = encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }],
      [
        validator.address,
        encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [agent.account.address, signature])
      ]
    );

    assert.equal(await wallet.read.isValidSignature([hash, encodedSignature]), ERC1271_MAGIC_VALUE);
  });
});
