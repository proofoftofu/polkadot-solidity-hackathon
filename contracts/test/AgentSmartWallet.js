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
const OPERATION_KIND_CALL = 0;
const OPERATION_KIND_XCM_TELEPORT = 1;
const TELEPORT_SELECTOR = "0x3dfb9f0d";
const ROUTER_DESTINATION = encodeAbiParameters(
  [{ type: "uint8" }, { type: "uint32" }, { type: "bytes20" }],
  [1, 2004, "0x1111111111111111111111111111111111111111"]
);
const TELEPORT_CONFIG = {
  destinationParaId: 1004,
  beneficiaryAccountId32: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48",
  amount: 10_000_000_000n,
  localFee: 1_000_000_000n,
  remoteFee: 1_000_000_000n
};

function encodeSingleExecution(target, value, callData) {
  return `${target.toLowerCase()}${padHex(toHex(value), { size: 32 }).slice(2)}${callData.slice(2)}`;
}

function sessionInitData(
  agent,
  allowedTarget,
  selector,
  expiresAt,
  chainId,
  {
    sponsorshipAllowed = true,
    operationKind = OPERATION_KIND_CALL,
    destinationParaId = 0,
    beneficiaryAccountId32 = zeroHash,
    maxTeleportAmount = 0n,
    maxLocalFee = 0n,
    maxRemoteFee = 0n,
    remainingCalls = 2,
    remainingValue = parseEther("1")
  } = {}
) {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
          { type: "bytes4" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint32" },
          { type: "uint128" },
          { type: "bool" },
          { type: "uint8" },
          {
            type: "tuple",
            components: [
              { type: "uint32" },
              { type: "bytes32" },
              { type: "uint128" },
              { type: "uint128" },
              { type: "uint128" }
            ]
          }
        ]
      }
    ],
    [
      [
        agent.account.address,
        stringToHex("agent.execute", { size: 32 }),
        chainId,
        allowedTarget.address,
        selector,
        BigInt(expiresAt),
        0n,
        remainingCalls,
        remainingValue,
        sponsorshipAllowed,
        operationKind,
        [
          destinationParaId,
          beneficiaryAccountId32,
          maxTeleportAmount,
          maxLocalFee,
          maxRemoteFee
        ]
      ]
    ]
  );
}

function encodeTeleportExecution(dispatcher, requestId, teleportConfig) {
  return encodeSingleExecution(
    dispatcher.address,
    0n,
    encodeFunctionData({
      abi: dispatcher.abi,
      functionName: "executeTeleport",
      args: [requestId, teleportConfig]
    })
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
    const routerArtifact = await readArtifact("mocks/MockMoonbeamXcmRouter.sol", "MockMoonbeamXcmRouter");
    const xcmPrecompileArtifact = await readArtifact("mocks/MockXcmPrecompile.sol", "MockXcmPrecompile");
    const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");

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
    const routerAddress = await deployFromArtifact(deployer, publicClient, routerArtifact, [ROUTER_DESTINATION]);
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
      [walletAddress, xcmPrecompileAddress]
    );
    const paymasterAddress = await deployFromArtifact(
      deployer,
      publicClient,
      paymasterArtifact,
      [sponsor.account.address, entryPoint.address]
    );
    const validator = await getContract(deployer, publicClient, validatorArtifact, validatorAddress);
    const executor = await getContract(deployer, publicClient, executorArtifact, executorAddress);
    const xcmPrecompile = await getContract(deployer, publicClient, xcmPrecompileArtifact, xcmPrecompileAddress);
    const dispatcher = await getContract(deployer, publicClient, dispatcherArtifact, dispatcherAddress);
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
      xcmPrecompile,
      dispatcher,
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

  it("allows a session-key XCM teleport only for the permitted destination policy", async function () {
    const { owner, agent, wallet, validator, dispatcher, xcmPrecompile } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);
    const requestId = stringToHex("req-xcm", { size: 32 });
    const executionCalldata = encodeTeleportExecution(dispatcher, requestId, TELEPORT_CONFIG);

    await wallet.write.installModule(
      [
        1n,
        validator.address,
        sessionInitData(agent, dispatcher, TELEPORT_SELECTOR, expiresAt, chainId, {
          sponsorshipAllowed: false,
          operationKind: OPERATION_KIND_XCM_TELEPORT,
          destinationParaId: TELEPORT_CONFIG.destinationParaId,
          beneficiaryAccountId32: TELEPORT_CONFIG.beneficiaryAccountId32,
          maxTeleportAmount: TELEPORT_CONFIG.amount,
          maxLocalFee: TELEPORT_CONFIG.localFee,
          maxRemoteFee: TELEPORT_CONFIG.remoteFee,
          remainingValue: TELEPORT_CONFIG.amount
        })
      ],
      { account: owner.account }
    );

    await validator.write.executeSession([wallet.address, BASE_MODE, executionCalldata, chainId], {
      account: agent.account
    });

    const executed = await xcmPrecompile.getEvents.XcmExecuted();
    assert.equal(executed.length > 0, true);

    const session = await validator.read.sessions([wallet.address]);
    assert.equal(session[7], 1);
    assert.equal(session[8], 0n);
  });

  it("rejects a session-key XCM teleport to an unauthorized parachain", async function () {
    const { owner, agent, wallet, validator, dispatcher } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);
    const requestId = stringToHex("req-xcm-bad", { size: 32 });
    const executionCalldata = encodeTeleportExecution(dispatcher, requestId, {
      ...TELEPORT_CONFIG,
      destinationParaId: 2000
    });

    await wallet.write.installModule(
      [
        1n,
        validator.address,
        sessionInitData(agent, dispatcher, TELEPORT_SELECTOR, expiresAt, chainId, {
          sponsorshipAllowed: false,
          operationKind: OPERATION_KIND_XCM_TELEPORT,
          destinationParaId: TELEPORT_CONFIG.destinationParaId,
          beneficiaryAccountId32: TELEPORT_CONFIG.beneficiaryAccountId32,
          maxTeleportAmount: TELEPORT_CONFIG.amount,
          maxLocalFee: TELEPORT_CONFIG.localFee,
          maxRemoteFee: TELEPORT_CONFIG.remoteFee,
          remainingValue: TELEPORT_CONFIG.amount
        })
      ],
      { account: owner.account }
    );

    await assert.rejects(
      validator.write.executeSession([wallet.address, BASE_MODE, executionCalldata, chainId], {
        account: agent.account
      })
    );
  });
});
