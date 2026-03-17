import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getContract, http } from "viem";

import { POLKADOT_HUB_CHAIN_ID } from "./constants.js";
import { getEnv } from "./server-env.js";

const CONTRACTS_ROOT = path.join(process.cwd(), "..", "contracts");
const DEPLOYMENTS_ROOT = path.join(CONTRACTS_ROOT, "deployments");
const ABI_ROOT = path.join(DEPLOYMENTS_ROOT, "abi");

let cache;
const DEFAULT_POLKADOT_RPC_URL = "https://eth-rpc-testnet.polkadot.io";

const CURRENT_WALLET_FACTORY_ABI = [
  {
    type: "function",
    name: "predictWallet",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "predicted", type: "address" }]
  },
  {
    type: "function",
    name: "createWallet",
    stateMutability: "nonpayable",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "wallet", type: "address" }]
  },
  {
    type: "function",
    name: "wallets",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "address" }]
  }
];

const CURRENT_SESSION_VALIDATOR_ABI = [
  {
    type: "function",
    name: "getSessionState",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "replayNonce", type: "uint64" },
      { name: "remainingCalls", type: "uint32" },
      { name: "remainingValue", type: "uint128" },
      { name: "operationKind", type: "uint8" },
      { name: "installed", type: "bool" }
    ]
  }
];

const CURRENT_WALLET_EXTENSION_ABI = [
  {
    type: "function",
    name: "configureValidator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "module", type: "address" },
      { name: "deInitData", type: "bytes" },
      { name: "initData", type: "bytes" }
    ],
    outputs: []
  }
];

const CURRENT_DISPATCHER_ABI = [
  {
    type: "function",
    name: "executeProgram",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "bytes32" },
      {
        name: "program",
        type: "tuple",
        components: [
          { name: "endpointKind", type: "uint8" },
          { name: "endpointParaId", type: "uint32" },
          {
            name: "instructions",
            type: "tuple[]",
            components: [
              { name: "kind", type: "uint8" },
              { name: "assetId", type: "bytes32" },
              { name: "amount", type: "uint128" },
              { name: "paraId", type: "uint32" },
              { name: "accountId32", type: "bytes32" }
            ]
          }
        ]
      }
    ],
    outputs: []
  }
];

const CURRENT_ENTRY_POINT_ABI = [
  {
    type: "error",
    name: "AccountExecutionFailed",
    inputs: [{ name: "reason", type: "bytes" }]
  },
  {
    type: "function",
    name: "handleOps",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "getUserOpHash",
    stateMutability: "view",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [{ name: "", type: "bytes32" }]
  }
];

async function readJson(filePath) {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents);
}

export async function getContractsConfig() {
  if (!cache) {
    const [addresses, hubDeployment, walletFactoryArtifact, walletArtifact, validatorArtifact] =
      await Promise.all([
        readJson(path.join(DEPLOYMENTS_ROOT, "addresses.json")),
        readJson(path.join(DEPLOYMENTS_ROOT, "polkadotTestnet.json")),
        readJson(path.join(ABI_ROOT, "WalletFactory.json")),
        readJson(path.join(ABI_ROOT, "AgentSmartWallet.json")),
        readJson(path.join(ABI_ROOT, "SessionKeyValidatorModule.json"))
      ]);

    cache = {
      addresses,
      hubDeployment,
      rpcUrl: getEnv("POLKADOT_RPC_URL", DEFAULT_POLKADOT_RPC_URL),
      chain: {
        id: Number(POLKADOT_HUB_CHAIN_ID),
        name: "Polkadot Hub Testnet",
        nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
        rpcUrls: {
          default: {
            http: [getEnv("POLKADOT_RPC_URL", DEFAULT_POLKADOT_RPC_URL)]
          }
        }
      },
      abis: {
        walletFactory: CURRENT_WALLET_FACTORY_ABI,
        wallet: [...walletArtifact.abi, ...CURRENT_WALLET_EXTENSION_ABI],
        sessionKeyValidatorModule: CURRENT_SESSION_VALIDATOR_ABI,
        crossChainDispatcher: CURRENT_DISPATCHER_ABI,
        entryPoint: CURRENT_ENTRY_POINT_ABI
      }
    };
  }

  return cache;
}

export async function getReadClient() {
  const config = await getContractsConfig();
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl)
  });
}

export async function getWalletFactoryContract() {
  const config = await getContractsConfig();
  const publicClient = await getReadClient();
  return getContract({
    address: config.hubDeployment.contracts.walletFactory,
    abi: config.abis.walletFactory,
    client: publicClient
  });
}
