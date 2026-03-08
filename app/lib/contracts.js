import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getContract, http } from "viem";

import { POLKADOT_HUB_CHAIN_ID } from "./constants.js";

const CONTRACTS_ROOT = path.join(process.cwd(), "..", "contracts");
const DEPLOYMENTS_ROOT = path.join(CONTRACTS_ROOT, "deployments");
const ABI_ROOT = path.join(DEPLOYMENTS_ROOT, "abi");

let cache;

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
      rpcUrl: "https://services.polkadothub-rpc.com/testnet",
      chain: {
        id: Number(POLKADOT_HUB_CHAIN_ID),
        name: "Polkadot Hub Testnet",
        nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
        rpcUrls: {
          default: {
            http: ["https://services.polkadothub-rpc.com/testnet"]
          }
        }
      },
      abis: {
        walletFactory: walletFactoryArtifact.abi,
        wallet: walletArtifact.abi,
        sessionKeyValidatorModule: validatorArtifact.abi,
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
