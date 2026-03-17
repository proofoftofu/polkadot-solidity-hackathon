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
const OPERATION_KIND_XCM_PROGRAM = 1;
const ENDPOINT_KIND_EXECUTE = 0;
const XCM_INSTRUCTION_WITHDRAW_ASSET = 0;
const XCM_INSTRUCTION_PAY_FEES = 2;
const XCM_INSTRUCTION_INITIATE_TRANSFER = 3;
const XCM_INSTRUCTION_DEPOSIT_ASSET = 4;
const XCM_PROGRAM_SELECTOR = "0x9d998c8f";
const PAS_ASSET_ID = keccak256(stringToHex("polkadot-hub/pas-native"));
const ROUTER_DESTINATION = encodeAbiParameters(
  [{ type: "uint8" }, { type: "uint32" }, { type: "bytes20" }],
  [1, 2004, "0x1111111111111111111111111111111111111111"]
);
const BENEFICIARY = "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";
const XCM_PROGRAM = {
  endpointKind: ENDPOINT_KIND_EXECUTE,
  endpointParaId: 0,
  instructions: [
    { kind: 0, assetId: PAS_ASSET_ID, amount: 10_000_000_000n, paraId: 0, accountId32: zeroHash },
    { kind: 2, assetId: PAS_ASSET_ID, amount: 1_000_000_000n, paraId: 0, accountId32: zeroHash },
    { kind: 3, assetId: PAS_ASSET_ID, amount: 1_000_000_000n, paraId: 1004, accountId32: zeroHash },
    { kind: 4, assetId: zeroHash, amount: 0n, paraId: 0, accountId32: BENEFICIARY }
  ]
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
    allowedEndpointKinds = [],
    allowedInstructionKinds = [],
    allowedDestinationParaIds = [],
    allowedBeneficiaries = [],
    assetLimits = [],
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
          { type: "uint8[]" },
          { type: "uint8[]" }
          ,
          { type: "uint32[]" },
          { type: "bytes32[]" },
          {
            type: "tuple[]",
            components: [{ type: "bytes32" }, { type: "uint128" }]
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
        allowedEndpointKinds,
        allowedInstructionKinds,
        allowedDestinationParaIds,
        allowedBeneficiaries,
        assetLimits
      ]
    ]
  );
}

function encodeProgramExecution(dispatcher, requestId, program) {
  return encodeSingleExecution(
    dispatcher.address,
    0n,
    encodeFunctionData({
      abi: dispatcher.abi,
      functionName: "executeProgram",
      args: [requestId, program]
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

async function buildBootstrapUserOp({
  entryPoint,
  walletFactory,
  predictedWalletAddress,
  owner,
  validator,
  target,
  agent,
  expiresAt,
  targetChainId
}) {
  const initCode = `${walletFactory.address.toLowerCase()}${encodeFunctionData({
    abi: walletFactory.abi,
    functionName: "createWallet",
    args: [owner.account.address]
  }).slice(2)}`;
  const callData = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "bootstrapInstallModule",
        stateMutability: "nonpayable",
        inputs: [
          { name: "moduleTypeId", type: "uint256" },
          { name: "module", type: "address" },
          { name: "initData", type: "bytes" }
        ],
        outputs: []
      }
    ],
    functionName: "bootstrapInstallModule",
    args: [
      1n,
      validator.address,
      sessionInitData(agent, target, "0x62f4b543", expiresAt, targetChainId)
    ]
  });

  const userOp = {
    sender: predictedWalletAddress,
    nonce: 0n,
    initCode,
    callData,
    accountGasLimits: zeroHash,
    preVerificationGas: 0n,
    gasFees: zeroHash,
    paymasterAndData: "0x",
    signature: "0x"
  };

  const userOpHash = await entryPoint.read.getUserOpHash([userOp]);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [userOpHash, predictedWalletAddress, targetChainId]
    )
  );
  const ownerSignature = await owner.signMessage({ message: { raw: payloadHash } });
  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [zeroAddress(), ownerSignature]
  );

  return { userOp, userOpHash };
}

async function buildOwnerRelayUserOp({
  entryPoint,
  wallet,
  owner,
  callData,
  nonce = 0n,
  targetChainId
}) {
  const userOp = {
    sender: wallet.address,
    nonce,
    initCode: "0x",
    callData,
    accountGasLimits: zeroHash,
    preVerificationGas: 0n,
    gasFees: zeroHash,
    paymasterAndData: "0x",
    signature: "0x"
  };

  const userOpHash = await entryPoint.read.getUserOpHash([userOp]);
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [userOpHash, wallet.address, targetChainId]
    )
  );
  const ownerSignature = await owner.signMessage({ message: { raw: payloadHash } });
  userOp.signature = encodeAbiParameters(
    [{ type: "address" }, { type: "bytes" }],
    [zeroAddress(), ownerSignature]
  );

  return { userOp, userOpHash };
}

function zeroAddress() {
  return "0x0000000000000000000000000000000000000000";
}

describe("AgentSmartWallet", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  async function deployFixture({ createWallet = true } = {}) {
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
    let walletAddress = predictedWalletAddress;
    let wallet;
    if (createWallet) {
      await walletFactory.write.createWallet([owner.account.address], { account: deployer.account });
      walletAddress = await walletFactory.read.wallets([owner.account.address]);
      wallet = await getContract(deployer, publicClient, walletArtifact, walletAddress);
    }
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

  it("deploys the wallet from initCode on the first user operation", async function () {
    const { owner, agent, target, entryPoint, walletFactory, predictedWalletAddress, validator } =
      await deployFixture({ createWallet: false });
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    const { userOp, userOpHash } = await buildBootstrapUserOp({
      entryPoint,
      walletFactory,
      predictedWalletAddress,
      owner,
      validator,
      target,
      agent,
      expiresAt,
      targetChainId: chainId
    });

    await viem.assertions.emitWithArgs(entryPoint.write.handleOps([[userOp]]), entryPoint, "UserOperationHandled", [
      getAddress(predictedWalletAddress),
      userOpHash,
      zeroAddress()
    ]);

    const walletArtifact = await readArtifact("AgentSmartWallet.sol", "AgentSmartWallet");
    const deployedWallet = await getContract(owner, publicClient, walletArtifact, predictedWalletAddress);

    assert.notEqual(await publicClient.getCode({ address: predictedWalletAddress }), undefined);
    assert.notEqual(await publicClient.getCode({ address: predictedWalletAddress }), "0x");
    assert.equal(await deployedWallet.read.isModuleInstalled([1n, validator.address, "0x"]), true);
    assert.equal(await walletFactory.read.wallets([owner.account.address]), getAddress(predictedWalletAddress));
  });

  it("allows a deployed wallet to install the validator through an owner-signed relayed user operation", async function () {
    const { owner, agent, target, entryPoint, wallet, validator } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);

    const callData = encodeFunctionData({
      abi: wallet.abi,
      functionName: "configureValidator",
      args: [validator.address, "0x", sessionInitData(agent, target, "0x62f4b543", expiresAt, chainId)]
    });

    const { userOp, userOpHash } = await buildOwnerRelayUserOp({
      entryPoint,
      wallet,
      owner,
      callData,
      nonce: 0n,
      targetChainId: chainId
    });

    await viem.assertions.emitWithArgs(entryPoint.write.handleOps([[userOp]]), wallet, "UserOperationExecuted", [
      userOpHash,
      zeroAddress()
    ]);

    assert.equal(await wallet.read.isModuleInstalled([1n, validator.address, "0x"]), true);
    assert.equal(await wallet.read.nonce(), 1n);
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
    const executionCalldata = encodeProgramExecution(dispatcher, requestId, XCM_PROGRAM);

    await wallet.write.installModule(
      [
        1n,
        validator.address,
        sessionInitData(agent, dispatcher, XCM_PROGRAM_SELECTOR, expiresAt, chainId, {
          sponsorshipAllowed: false,
          operationKind: OPERATION_KIND_XCM_PROGRAM,
          allowedEndpointKinds: [ENDPOINT_KIND_EXECUTE],
          allowedInstructionKinds: [
            XCM_INSTRUCTION_WITHDRAW_ASSET,
            XCM_INSTRUCTION_PAY_FEES,
            XCM_INSTRUCTION_INITIATE_TRANSFER,
            XCM_INSTRUCTION_DEPOSIT_ASSET
          ],
          allowedDestinationParaIds: [1004],
          allowedBeneficiaries: [BENEFICIARY],
          assetLimits: [[PAS_ASSET_ID, 10_000_000_000n]],
          remainingValue: 10_000_000_000n
        })
      ],
      { account: owner.account }
    );

    await validator.write.executeSession([wallet.address, BASE_MODE, executionCalldata, chainId], {
      account: agent.account
    });

    const executed = await xcmPrecompile.getEvents.XcmExecuted();
    assert.equal(executed.length > 0, true);

    const session = await validator.read.getSessionState([wallet.address]);
    assert.equal(session[1], 1);
    assert.equal(session[2], 0n);
  });

  it("rejects a session-key XCM teleport to an unauthorized parachain", async function () {
    const { owner, agent, wallet, validator, dispatcher } = await deployFixture();
    const latestBlock = await publicClient.getBlock();
    const chainId = BigInt(await publicClient.getChainId());
    const expiresAt = Number(latestBlock.timestamp + 3600n);
    const requestId = stringToHex("req-xcm-bad", { size: 32 });
    const executionCalldata = encodeProgramExecution(dispatcher, requestId, {
      ...XCM_PROGRAM,
      instructions: [
        XCM_PROGRAM.instructions[0],
        XCM_PROGRAM.instructions[1],
        { ...XCM_PROGRAM.instructions[2], paraId: 2000 },
        XCM_PROGRAM.instructions[3]
      ]
    });

    await wallet.write.installModule(
      [
        1n,
        validator.address,
        sessionInitData(agent, dispatcher, XCM_PROGRAM_SELECTOR, expiresAt, chainId, {
          sponsorshipAllowed: false,
          operationKind: OPERATION_KIND_XCM_PROGRAM,
          allowedEndpointKinds: [ENDPOINT_KIND_EXECUTE],
          allowedInstructionKinds: [
            XCM_INSTRUCTION_WITHDRAW_ASSET,
            XCM_INSTRUCTION_PAY_FEES,
            XCM_INSTRUCTION_INITIATE_TRANSFER,
            XCM_INSTRUCTION_DEPOSIT_ASSET
          ],
          allowedDestinationParaIds: [1004],
          allowedBeneficiaries: [BENEFICIARY],
          assetLimits: [[PAS_ASSET_ID, 10_000_000_000n]],
          remainingValue: 10_000_000_000n
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
