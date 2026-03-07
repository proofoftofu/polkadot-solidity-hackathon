import fs from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  parseAbiParameters,
  publicActions,
  stringToHex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts", "contracts");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

export const NETWORKS = {
  polkadotTestnet: {
    key: "polkadotTestnet",
    rpcUrl: process.env.POLKADOT_RPC_URL ?? "https://services.polkadothub-rpc.com/testnet",
    chainId: 420420417,
    label: "Polkadot Hub Testnet"
  },
  moonbaseAlpha: {
    key: "moonbaseAlpha",
    rpcUrl: process.env.MOONBASE_RPC_URL ?? "https://rpc.api.moonbase.moonbeam.network",
    chainId: 1287,
    label: "Moonbase Alpha"
  }
};

export const XCM_PRECOMPILE = "0x00000000000000000000000000000000000a0000";
export const DEFAULT_MESSAGE_PREFIX = stringToHex("TOFU_XCM_V1");

function chainConfig(name) {
  const config = NETWORKS[name];
  if (!config) {
    throw new Error(`Unsupported network ${name}`);
  }
  return {
    id: config.chainId,
    name: config.label,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: {
      default: {
        http: [config.rpcUrl]
      }
    }
  };
}

export function requirePrivateKey() {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error("Set PRIVATE_KEY before running deployment or live test scripts.");
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

export function createClients(networkName) {
  const config = NETWORKS[networkName];
  const account = privateKeyToAccount(requirePrivateKey());
  const chain = chainConfig(networkName);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport }).extend(publicActions);
  return { config, account, publicClient, walletClient };
}

export async function readArtifact(contractFile, contractName = contractFile.replace(/\.sol$/, "")) {
  const file = path.join(ARTIFACTS_DIR, contractFile, `${contractName}.json`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function deployFromArtifact(walletClient, publicClient, artifact, args = []) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return getAddress(receipt.contractAddress);
}

export async function getContract(walletClient, artifact, address) {
  return walletClient.getContract({
    abi: artifact.abi,
    address: getAddress(address)
  });
}

export async function readDeployment(networkName) {
  const file = path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeDeployment(networkName, deployment) {
  await fs.mkdir(DEPLOYMENTS_DIR, { recursive: true });
  const file = path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
  await fs.writeFile(file, `${JSON.stringify(deployment, null, 2)}\n`);
}

export async function updateAddressesIndex(networkName, deployment) {
  const file = path.join(DEPLOYMENTS_DIR, "addresses.json");
  let index = { polkadotTestnet: {}, moonbaseAlpha: {} };
  try {
    index = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}

  index[networkName] = deployment.contracts;
  await fs.writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
}

export function buildMoonbeamDestination(accountKey20) {
  return encodeAbiParameters(
    parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
    [1, 2004, getAddress(accountKey20)]
  );
}

export function buildRemoteCall(targetAbi, targetAddress, memo, requestId, receiverAddress) {
  return {
    destinationChainId: 1287n,
    receiver: getAddress(receiverAddress),
    target: getAddress(targetAddress),
    value: 0n,
    callData: encodeAbiParameters(parseAbiParameters("bytes32 memo"), [memo]),
    requestId
  };
}
