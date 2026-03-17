import { readFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { ApiPromise, WsProvider } from "@polkadot/api";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import { blake2AsU8a } from "@polkadot/util-crypto";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  getContract,
  getContractAddress,
  http,
  parseEther,
  publicActions
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getContractsConfig } from "./contracts.js";
import { getEnv, getRequiredEnv } from "./server-env.js";

const CONTRACTS_ROOT = path.join(process.cwd(), "..", "contracts");
const ARTIFACTS_ROOT = path.join(CONTRACTS_ROOT, "artifacts", "contracts");
const CONTRACTS_SOURCE_ROOT = path.join(CONTRACTS_ROOT, "contracts");
const DEFAULT_HUB_WS_URLS = [
  "wss://asset-hub-paseo-rpc.n.dwellir.com",
  "wss://testnet-passet-hub.polkadot.io",
  "wss://pas-rpc.stakeworld.io/assethub"
];
const SUBSTRATE_WS_RETRIES = Number.parseInt(getEnv("SUBSTRATE_WS_RETRIES", "3"), 10);
const SUBSTRATE_WS_RETRY_DELAY_MS = Number.parseInt(getEnv("SUBSTRATE_WS_RETRY_DELAY_MS", "1500"), 10);
const SUBSTRATE_WS_CONNECT_TIMEOUT_MS = Number.parseInt(getEnv("SUBSTRATE_WS_CONNECT_TIMEOUT_MS", "12000"), 10);
const contractsRequire = createRequire(path.join(CONTRACTS_ROOT, "package.json"));
const solc = contractsRequire("solc");
let compiledContractsPromise;

function evmToSubstrateAccount(address) {
  return u8aToHex(blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256));
}

async function getSoliditySources(dir, prefix = "contracts") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sources = {};

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      Object.assign(sources, await getSoliditySources(fullPath, relativePath));
      continue;
    }
    if (!entry.name.endsWith(".sol")) {
      continue;
    }
    sources[relativePath] = {
      content: await fs.readFile(fullPath, "utf8")
    };
  }

  return sources;
}

async function compileContracts() {
  const sources = await getSoliditySources(CONTRACTS_SOURCE_ROOT);
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const errors = output.errors.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      throw new Error(errors.map((entry) => entry.formattedMessage).join("\n\n"));
    }
  }
  return output.contracts;
}

async function readArtifact(contractFile, contractName) {
  try {
    compiledContractsPromise ??= compileContracts();
    const contracts = await compiledContractsPromise;
    const sourcePath = path.join("contracts", contractFile);
    const contract = contracts[sourcePath]?.[contractName];
    if (contract) {
      return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`
      };
    }
  } catch (error) {
    console.warn("[dispatcher-runtime] falling back to bundled artifact", {
      contractFile,
      contractName,
      error: error?.message
    });
  }

  const artifactPath = path.join(ARTIFACTS_ROOT, contractFile, `${contractName}.json`);
  return JSON.parse(await readFile(artifactPath, "utf8"));
}

function createOperatorClients(config) {
  const privateKey = getRequiredEnv("PRIVATE_KEY");
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(normalized);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({
    chain: config.chain,
    transport
  });
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport
  }).extend(publicActions);
  return {
    account,
    publicClient,
    walletClient
  };
}

async function getFeeOverrides(publicClient) {
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? fees.gasPrice;

  if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
    return {};
  }

  return {
    maxFeePerGas,
    maxPriorityFeePerGas
  };
}

async function sendNative(walletClient, publicClient, to, value) {
  const feeOverrides = await getFeeOverrides(publicClient);
  const hash = await walletClient.sendTransaction({
    account: walletClient.account,
    chain: walletClient.chain,
    to,
    value,
    ...feeOverrides
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

function isAlreadyImportedError(error) {
  const message = `${error?.shortMessage ?? ""}\n${error?.details ?? ""}\n${error?.message ?? ""}`.toLowerCase();
  return (
    message.includes("transaction already imported") ||
    message.includes("nonce provided for the transaction is lower") ||
    message.includes("priority is too low") ||
    message.includes("replacement transaction underpriced")
  );
}

async function waitForContractCode(publicClient, address, attempts = 18, delayMs = 5000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = await publicClient.getCode({ address });
    if (code && code !== "0x") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function ensureEvmBalance(sender, recipient, minBalance) {
  const current = await sender.publicClient.getBalance({ address: recipient });
  if (current >= minBalance) {
    return { balance: current, txHash: null };
  }

  const receipt = await sendNative(
    sender.walletClient,
    sender.publicClient,
    recipient,
    minBalance - current
  );
  console.log("[dispatcher-runtime] walletTopUpTx", receipt.transactionHash);
  return {
    balance: await sender.publicClient.getBalance({ address: recipient }),
    txHash: receipt.transactionHash
  };
}

function getHubWsUrls() {
  const envValue = getEnv("POLKADOT_WS_URL");
  if (!envValue) {
    return DEFAULT_HUB_WS_URLS;
  }
  return envValue.split(",").map((url) => url.trim()).filter(Boolean);
}

async function createSubstrateApi() {
  let lastError;
  const urls = getHubWsUrls();

  for (const url of urls) {
    for (let attempt = 1; attempt <= SUBSTRATE_WS_RETRIES; attempt += 1) {
      let provider;
      try {
        provider = new WsProvider(url);
        const api = await Promise.race([
          ApiPromise.create({ provider }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), SUBSTRATE_WS_CONNECT_TIMEOUT_MS)
          )
        ]);
        await Promise.race([
          api.isReady,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out waiting for api.isReady on ${url}`)), SUBSTRATE_WS_CONNECT_TIMEOUT_MS)
          )
        ]);
        return api;
      } catch (error) {
        lastError = error;
        try {
          provider?.disconnect();
        } catch {}
        if (attempt < SUBSTRATE_WS_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, SUBSTRATE_WS_RETRY_DELAY_MS * attempt));
        }
      }
    }
  }

  throw lastError;
}

function getXcmPrecompile(publicClient, walletClient, address) {
  return getContract({
    address,
    abi: [
      {
        type: "function",
        name: "weighMessage",
        stateMutability: "view",
        inputs: [{ name: "message", type: "bytes" }],
        outputs: [
          {
            name: "weight",
            type: "tuple",
            components: [
              { name: "refTime", type: "uint64" },
              { name: "proofSize", type: "uint64" }
            ]
          }
        ]
      },
      {
        type: "function",
        name: "execute",
        stateMutability: "nonpayable",
        inputs: [
          { name: "message", type: "bytes" },
          {
            name: "weight",
            type: "tuple",
            components: [
              { name: "refTime", type: "uint64" },
              { name: "proofSize", type: "uint64" }
            ]
          }
        ],
        outputs: []
      }
    ],
    client: {
      public: publicClient,
      wallet: walletClient
    }
  });
}

async function readFreeBalance(api, accountId32) {
  const account = await api.query.system.account(accountId32);
  return BigInt(account.data.free.toString());
}

function buildLocalFundMessage(beneficiaryAccountId32, transferAmount, executionFee) {
  return {
    V5: [
      {
        WithdrawAsset: [
          {
            id: { parents: 1, interior: { Here: null } },
            fun: { Fungible: transferAmount }
          }
        ]
      },
      {
        BuyExecution: {
          fees: {
            id: { parents: 1, interior: { Here: null } },
            fun: { Fungible: executionFee }
          },
          weight_limit: { Unlimited: null }
        }
      },
      {
        DepositAsset: {
          assets: { Wild: { AllCounted: 1 } },
          beneficiary: {
            parents: 0,
            interior: {
              X1: [
                {
                  AccountId32: {
                    network: null,
                    id: beneficiaryAccountId32
                  }
                }
              ]
            }
          }
        }
      }
    ]
  };
}

async function fundDerivedAccountIfNeeded({
  owner,
  hubApi,
  xcmPrecompile,
  beneficiaryAccountId32,
  minBalance,
  topUpBalance
}) {
  const current = await readFreeBalance(hubApi, beneficiaryAccountId32);
  if (current >= minBalance) {
    return { balance: current, txHash: null };
  }

  const transferAmount = topUpBalance - current;
  const feeAmount = BigInt(getEnv("XCM_LOCAL_FUND_EXECUTION_FEE", "1000000000"));
  const message = hubApi.createType(
    "XcmVersionedXcm",
    buildLocalFundMessage(beneficiaryAccountId32, transferAmount, feeAmount)
  ).toHex();
  const weight = await xcmPrecompile.read.weighMessage([message]);
  const txHash = await xcmPrecompile.write.execute([message, weight], { account: owner.account });
  console.log("[dispatcher-runtime] dispatcherDerivedFundTx", txHash);
  await owner.publicClient.waitForTransactionReceipt({ hash: txHash });
  return {
    balance: await readFreeBalance(hubApi, beneficiaryAccountId32),
    txHash
  };
}

export async function prepareWalletDispatcher(walletAddressInput, existingDispatcherAddress, options = {}) {
  const startedAt = Date.now();
  const config = await getContractsConfig();
  const operator = createOperatorClients(config);
  const dispatcherArtifact = await readArtifact("CrossChainDispatcher.sol", "CrossChainDispatcher");
  const walletAddress = getAddress(walletAddressInput);

  console.log("[dispatcher-runtime] prepare", {
    walletAddress,
    existingDispatcherAddress: existingDispatcherAddress ?? null
  });

  let dispatcherAddress = existingDispatcherAddress ? getAddress(existingDispatcherAddress) : null;
  let dispatcherDeployTx = null;

  if (!dispatcherAddress) {
    const deployNonce = await operator.publicClient.getTransactionCount({
      address: operator.account.address,
      blockTag: "pending"
    });
    const predictedDispatcherAddress = getContractAddress({
      from: operator.account.address,
      nonce: BigInt(deployNonce)
    });

    try {
      const feeOverrides = await getFeeOverrides(operator.publicClient);
      const txHash = await operator.walletClient.deployContract({
        abi: dispatcherArtifact.abi,
        bytecode: dispatcherArtifact.bytecode,
        args: [walletAddress, config.hubDeployment.contracts.xcmPrecompile],
        nonce: deployNonce,
        ...feeOverrides
      });
      dispatcherDeployTx = txHash;
      console.log("[dispatcher-runtime] dispatcherDeployTx", txHash);
      const receipt = await operator.publicClient.waitForTransactionReceipt({ hash: txHash });
      dispatcherAddress = getAddress(receipt.contractAddress);
    } catch (error) {
      if (!isAlreadyImportedError(error)) {
        throw error;
      }
      const deployed = await waitForContractCode(operator.publicClient, predictedDispatcherAddress);
      if (!deployed) {
        throw error;
      }
      dispatcherAddress = predictedDispatcherAddress;
      dispatcherDeployTx = "reused-pending";
      console.log("[dispatcher-runtime] dispatcherDeployTx reused-pending");
    }
  }

  const walletFunding = await ensureEvmBalance(
    operator,
    walletAddress,
    parseEther(getEnv("INTEGRATION_WALLET_EVM_BALANCE", "0.05"))
  );
  const dispatcherFunding = await ensureEvmBalance(
    operator,
    dispatcherAddress,
    parseEther(getEnv("INTEGRATION_DISPATCHER_EVM_BALANCE", "1"))
  );

  let dispatcherDerivedAccountId32 = null;
  let dispatcherDerivedBalance = null;
  let dispatcherDerivedFundTx = null;

  if (options.fundDerived) {
    const hubApi = await createSubstrateApi();
    try {
      const xcmPrecompile = getXcmPrecompile(
        operator.publicClient,
        operator.walletClient,
        config.hubDeployment.contracts.xcmPrecompile
      );
      dispatcherDerivedAccountId32 = evmToSubstrateAccount(dispatcherAddress);
      const funded = await fundDerivedAccountIfNeeded({
        owner: operator,
        hubApi,
        xcmPrecompile,
        beneficiaryAccountId32: dispatcherDerivedAccountId32,
        minBalance: BigInt(getEnv("INTEGRATION_DISPATCHER_DERIVED_MIN_BALANCE", "12000000000")),
        topUpBalance: BigInt(getEnv("INTEGRATION_DISPATCHER_DERIVED_TOP_UP", "20000000000"))
      });
      dispatcherDerivedBalance = funded.balance.toString();
      dispatcherDerivedFundTx = funded.txHash;
    } finally {
      await hubApi.disconnect().catch(() => {});
    }
  }

  console.log("[dispatcher-runtime] done", {
    dispatcherAddress,
    walletBalance: walletFunding.balance.toString(),
    dispatcherBalance: dispatcherFunding.balance.toString(),
    elapsedMs: Date.now() - startedAt
  });

  return {
    dispatcherAddress,
    walletAddress,
    walletBalance: walletFunding.balance.toString(),
    dispatcherBalance: dispatcherFunding.balance.toString(),
    dispatcherDerivedAccountId32,
    dispatcherDerivedBalance,
    dispatcherDeployTx,
    walletTopUpTx: walletFunding.txHash,
    dispatcherTopUpTx: dispatcherFunding.txHash,
    dispatcherDerivedFundTx
  };
}
