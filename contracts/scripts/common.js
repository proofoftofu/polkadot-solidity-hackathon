import fs from "node:fs/promises";
import path from "node:path";

import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import dotenv from "dotenv";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  getAddress,
  getContract as viemGetContract,
  http,
  hexToBytes,
  numberToHex,
  publicActions,
  parseAbiItem,
  pad,
  toHex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts", "contracts");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
let compiledContractsPromise;

export const NETWORKS = {
  polkadotTestnet: {
    key: "polkadotTestnet",
    rpcUrl: process.env.POLKADOT_RPC_URL ?? "https://services.polkadothub-rpc.com/testnet",
    wsUrls: (process.env.POLKADOT_WS_URL
      ? process.env.POLKADOT_WS_URL.split(",")
      : [
        "wss://asset-hub-paseo-rpc.n.dwellir.com",
        "wss://testnet-passet-hub.polkadot.io",
        "wss://pas-rpc.stakeworld.io/assethub"
      ]).map((url) => url.trim()).filter(Boolean),
    chainId: 420420417,
    label: "Polkadot Hub Testnet"
  },
  moonbaseAlpha: {
    key: "moonbaseAlpha",
    rpcUrl: process.env.MOONBASE_RPC_URL ?? "https://rpc.api.moonbase.moonbeam.network",
    wsUrls: [process.env.MOONBASE_WS_URL ?? "wss://wss.api.moonbase.moonbeam.network"],
    chainId: 1287,
    label: "Moonbase Alpha"
  },
  peoplePaseo: {
    key: "peoplePaseo",
    rpcUrl: process.env.PEOPLE_PASEO_RPC_URL ?? "https://people-paseo.dotters.network",
    wsUrls: [process.env.PEOPLE_PASEO_WS_URL ?? "wss://people-paseo.rpc.amforc.com"],
    chainId: 0,
    label: "People Chain Paseo"
  },
  shibuyaAstar: {
    key: "shibuyaAstar",
    rpcUrl: process.env.SHIBUYA_RPC_URL ?? "https://evm.shibuya.astar.network",
    wsUrls: [process.env.SHIBUYA_WS_URL ?? "wss://rpc.shibuya.astar.network"],
    chainId: 81,
    label: "Shibuya"
  }
};

export const XCM_PRECOMPILE = "0x00000000000000000000000000000000000a0000";
export const DEFAULT_MOONBASE_PARA_ID = Number.parseInt(process.env.MOONBASE_PARA_ID ?? "1000", 10);
export const DEFAULT_XCM_FEE_WEI = BigInt(process.env.XCM_FEE_WEI ?? "10000000000000000");
export const DEFAULT_TRANSACT_GAS_LIMIT = BigInt(process.env.XCM_TRANSACT_GAS_LIMIT ?? "300000");
export const DEFAULT_TRANSACT_REF_TIME = BigInt(process.env.XCM_TRANSACT_REF_TIME ?? "5000000000");
export const DEFAULT_TRANSACT_PROOF_SIZE = BigInt(process.env.XCM_TRANSACT_PROOF_SIZE ?? "200000");
export const DEFAULT_XCM_VERSION = Number.parseInt(process.env.XCM_VERSION ?? "5", 10);
export const PAS_UNITS = BigInt(process.env.XCM_TRANSFER_AMOUNT ?? "10000000000");
export const PAS_REMOTE_FEE = BigInt(process.env.XCM_REMOTE_FEE_AMOUNT ?? "100000000");
export const PAS_LOCAL_FEE = BigInt(process.env.XCM_LOCAL_FEE_AMOUNT ?? "100000000");
const SUBSTRATE_WS_RETRIES = Number.parseInt(process.env.SUBSTRATE_WS_RETRIES ?? "3", 10);
const SUBSTRATE_WS_RETRY_DELAY_MS = Number.parseInt(process.env.SUBSTRATE_WS_RETRY_DELAY_MS ?? "1500", 10);
const SUBSTRATE_WS_CONNECT_TIMEOUT_MS = Number.parseInt(process.env.SUBSTRATE_WS_CONNECT_TIMEOUT_MS ?? "12000", 10);

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
  const nonceManager = {
    value: undefined,
    async next() {
      if (this.value === undefined) {
        this.value = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending"
        });
      }
      const nonce = this.value;
      this.value += 1;
      return nonce;
    }
  };
  return { config, account, publicClient, walletClient, nonceManager };
}

export function deriveSiblingSovereignAccount(paraId) {
  const paraIdHex = toHex(Uint8Array.from([
    paraId & 0xff,
    (paraId >> 8) & 0xff,
    (paraId >> 16) & 0xff,
    (paraId >> 24) & 0xff
  ]));
  return getAddress(
    encodePacked(
      ["bytes4", "bytes4", "bytes12"],
      [toHex("sibl", { size: 4 }), paraIdHex, "0x000000000000000000000000"]
    )
  );
}

export async function createSubstrateApi(networkName) {
  let lastError;
  const urls = NETWORKS[networkName].wsUrls;

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
  const sources = await getSoliditySources(CONTRACTS_DIR);
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

export async function readArtifact(contractFile, contractName = contractFile.replace(/\.sol$/, "")) {
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

  const file = path.join(ARTIFACTS_DIR, contractFile, `${contractName}.json`);
  const artifact = JSON.parse(await fs.readFile(file, "utf8"));
  if (!artifact.abi || !artifact.bytecode) {
    throw new Error(`Artifact not found for ${sourcePath}:${contractName}`);
  }
  return artifact;
}

export async function deployFromArtifact(walletClient, publicClient, artifact, args = [], nonceManager) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
    nonce: nonceManager ? await nonceManager.next() : undefined
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return getAddress(receipt.contractAddress);
}

export async function writeContract(contractWrite, args, publicClient, nonceManager) {
  const hash = await contractWrite(args, {
    nonce: nonceManager ? await nonceManager.next() : undefined
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

export async function sendNative(walletClient, publicClient, nonceManager, to, value) {
  const hash = await walletClient.sendTransaction({
    account: walletClient.account,
    chain: walletClient.chain,
    nonce: nonceManager ? await nonceManager.next() : undefined,
    to,
    value
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

export async function getContract(walletClient, publicClient, artifact, address) {
  return viemGetContract({
    abi: artifact.abi,
    address: getAddress(address),
    client: {
      public: publicClient,
      wallet: walletClient
    }
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
  let index = { polkadotTestnet: {}, moonbaseAlpha: {}, peoplePaseo: {} };
  try {
    index = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}

  index[networkName] = deployment.contracts;
  await fs.writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
}

function createTypeWithFallback(api, typeNames, value) {
  let lastError;
  for (const typeName of typeNames) {
    try {
      return api.createType(typeName, value);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function encodeVersionedLocation(api, paraId, parents = 1, version = DEFAULT_XCM_VERSION) {
  const versionKey = `V${version}`;
  return createTypeWithFallback(
    api,
    ["XcmVersionedLocation", "VersionedLocation", "StagingXcmVersionedLocation"],
    {
      [versionKey]: {
        parents,
        interior: {
          X1: [{ Parachain: paraId }]
        }
      }
    }
  ).toHex();
}

export function encodeDestinationLocation(api, paraId, parents = 1) {
  return createTypeWithFallback(api, ["MultiLocation", "StagingXcmV5Location"], {
    parents,
    interior: {
      X1: [{ Parachain: paraId }]
    }
  }).toHex();
}

export function encodeVersionedXcm(api, instructions, version = DEFAULT_XCM_VERSION) {
  const versionKey = `V${version}`;
  return createTypeWithFallback(api, ["XcmVersionedXcm", "VersionedXcm", "StagingXcmVersionedXcm"], {
    [versionKey]: instructions
  }).toHex();
}

export function buildMoonbeamTransactCall(moonbeamApi, target, input, gasLimit = DEFAULT_TRANSACT_GAS_LIMIT) {
  return moonbeamApi.tx.ethereumXcm
    .transact({
      V2: {
        gasLimit,
        action: {
          Call: getAddress(target)
        },
        value: 0,
        input
      }
    })
    .method.toHex();
}

export async function estimateMoonbeamTransactWeight(moonbeamApi, payer, target, input, gasLimit = DEFAULT_TRANSACT_GAS_LIMIT) {
  const payment = await moonbeamApi.tx.ethereumXcm
    .transact({
      V2: {
        gasLimit,
        action: {
          Call: getAddress(target)
        },
        value: 0,
        input
      }
    })
    .paymentInfo(getAddress(payer));

  return payment.weight.toJSON ? payment.weight.toJSON() : payment.weight;
}

export function buildMoonbeamExecutionMessage(
  hubApi,
  ethereumXcmCall,
  {
    xcmVersion = DEFAULT_XCM_VERSION,
    feeAmount = DEFAULT_XCM_FEE_WEI,
    requireWeightAtMost = {
      refTime: DEFAULT_TRANSACT_REF_TIME,
      proofSize: DEFAULT_TRANSACT_PROOF_SIZE
    }
  } = {}
) {
  const feeAsset = {
    id: {
      parents: 0,
      interior: {
        X1: [{ PalletInstance: 3 }]
      }
    },
    fun: {
      Fungible: feeAmount
    }
  };

  return encodeVersionedXcm(
    hubApi,
    [
      { WithdrawAsset: [feeAsset] },
      { BuyExecution: [feeAsset, { Unlimited: null }] },
      {
        Transact: {
          originKind: "SovereignAccount",
          requireWeightAtMost,
          call: {
            encoded: ethereumXcmCall
          }
        }
      }
    ],
    xcmVersion
  );
}

export async function getHubParaId(hubApi) {
  return Number((await hubApi.query.parachainInfo.parachainId()).toString());
}

export function beneficiaryAccountHex(value) {
  if (value.startsWith("0x")) {
    return value.toLowerCase();
  }
  return toHex(decodeAddress(value));
}

export function beneficiarySs58(value, prefix = 0) {
  return encodeAddress(beneficiaryAccountHex(value), prefix);
}

export function buildParachainTeleportMessage(
  hubApi,
  paraId,
  beneficiary,
  {
    amount = PAS_UNITS,
    localFee = 1_000_000_000n,
    remoteFee = 1_000_000_000n,
    xcmVersion = DEFAULT_XCM_VERSION
  } = {}
) {
  const asset = {
    id: {
      parents: 1,
      interior: { Here: null }
    },
    fun: {
      Fungible: amount
    }
  };
  const feeAsset = {
    id: {
      parents: 1,
      interior: { Here: null }
    },
    fun: {
      Fungible: remoteFee
    }
  };

  return encodeVersionedXcm(
    hubApi,
    [
      { WithdrawAsset: [asset] },
      {
        PayFees: {
          asset: {
            id: {
              parents: 1,
              interior: { Here: null }
            },
            fun: {
              Fungible: localFee
            }
          }
        }
      },
      {
        InitiateTransfer: {
          destination: {
            parents: 1,
            interior: {
              X1: [{ Parachain: paraId }]
            }
          },
          remote_fees: {
            Teleport: {
              Definite: [feeAsset]
            }
          },
          preserve_origin: false,
          remote_xcm: [
            {
              DepositAsset: {
                assets: {
                  Wild: {
                    AllCounted: 1
                  }
                },
                beneficiary: {
                  parents: 0,
                  interior: {
                    X1: [
                      {
                        AccountId32: {
                          network: null,
                          id: beneficiaryAccountHex(beneficiary)
                        }
                      }
                    ]
                  }
                }
              }
            }
          ],
          assets: [
            {
              Teleport: {
                Wild: {
                  AllCounted: 1
                }
              }
            }
          ]
        }
      }
    ],
    xcmVersion
  );
}

export function buildPeopleChainTeleportMessage(hubApi, paraId, beneficiary, options = {}) {
  return buildParachainTeleportMessage(hubApi, paraId, beneficiary, options);
}

export function buildReserveTransferMessage(
  hubApi,
  paraId,
  beneficiary,
  {
    assetHubParaId = 1000,
    amount = 10n * PAS_UNITS,
    localFee = 1n * PAS_UNITS,
    remoteExecutionFee = 100_000_000n,
    xcmVersion = DEFAULT_XCM_VERSION
  } = {}
) {
  const teleportFeeAsset = {
    id: {
      parents: 1,
      interior: { Here: null }
    },
    fun: {
      Fungible: localFee
    }
  };

  return encodeVersionedXcm(
    hubApi,
    [
      {
        WithdrawAsset: [
          {
            id: {
              parents: 1,
              interior: { Here: null }
            },
            fun: {
              Fungible: amount
            }
          }
        ]
      },
      {
        PayFees: {
          asset: teleportFeeAsset
        }
      },
      {
        InitiateTransfer: {
          destination: {
            parents: 1,
            interior: {
              X1: [{ Parachain: assetHubParaId }]
            }
          },
          remote_fees: {
            Teleport: {
              Definite: [teleportFeeAsset]
            }
          },
          preserve_origin: false,
          remote_xcm: [
            {
              DepositReserveAsset: {
                assets: {
                  Wild: {
                    AllCounted: 1
                  }
                },
                dest: {
                  parents: 1,
                  interior: {
                    X1: [{ Parachain: paraId }]
                  }
                },
                xcm: [
                  {
                    BuyExecution: {
                      fees: {
                        id: {
                          parents: 1,
                          interior: { Here: null }
                        },
                        fun: {
                          Fungible: remoteExecutionFee
                        }
                      },
                      weight_limit: {
                        Unlimited: null
                      }
                    }
                  },
                  {
                    DepositAsset: {
                      assets: {
                        Wild: {
                          AllCounted: 1
                        }
                      },
                      beneficiary: {
                        parents: 0,
                        interior: {
                          X1: [
                            {
                              AccountId32: {
                                network: null,
                                id: beneficiaryAccountHex(beneficiary)
                              }
                            }
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            }
          ],
          assets: [
            {
              Teleport: {
                Wild: {
                  AllCounted: 1
                }
              }
            }
          ]
        }
      }
    ],
    xcmVersion
  );
}

export function buildContractSmokeMessage(hubApi, { xcmVersion = DEFAULT_XCM_VERSION } = {}) {
  return encodeVersionedXcm(
    hubApi,
    [{ ClearOrigin: null }],
    xcmVersion
  );
}

export async function ensureNativeBalance(
  clientBundle,
  address,
  { minBalance, topUpBalance } = {}
) {
  const currentBalance = await clientBundle.publicClient.getBalance({ address });
  if (minBalance !== undefined && currentBalance >= minBalance) {
    return { funded: false, balance: currentBalance };
  }

  const targetBalance = topUpBalance ?? minBalance;
  if (targetBalance === undefined || targetBalance <= currentBalance) {
    return { funded: false, balance: currentBalance };
  }

  await sendNative(
    clientBundle.walletClient,
    clientBundle.publicClient,
    clientBundle.nonceManager,
    address,
    targetBalance - currentBalance
  );

  return {
    funded: true,
    balance: await clientBundle.publicClient.getBalance({ address })
  };
}

export async function readSystemFreeBalance(api, accountId) {
  const account = await api.query.system.account(beneficiaryAccountHex(accountId));
  const data = account.toJSON()?.data ?? account.toHuman()?.data;
  return BigInt(data.free.toString().replace(/,/g, ""));
}

export async function waitForSystemFreeBalanceIncrease(api, accountId, initialBalance) {
  const timeoutMs = Number.parseInt(process.env.XCM_RESULT_TIMEOUT_MS ?? "180000", 10);
  const pollMs = Number.parseInt(process.env.XCM_RESULT_POLL_MS ?? "5000", 10);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const balance = await readSystemFreeBalance(api, accountId);
    if (balance > initialBalance) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for destination balance increase.");
}

export async function ensureMoonbeamSovereignBalance(
  moonbeam,
  sovereignAccount,
  {
    minBalance = DEFAULT_XCM_FEE_WEI * 2n,
    topUpBalance = DEFAULT_XCM_FEE_WEI * 10n
  } = {}
) {
  const currentBalance = await moonbeam.publicClient.getBalance({ address: sovereignAccount });
  if (currentBalance >= minBalance) {
    return { funded: false, balance: currentBalance };
  }

  const value = topUpBalance > currentBalance ? topUpBalance - currentBalance : minBalance;
  const hash = await moonbeam.walletClient.sendTransaction({
    account: moonbeam.account,
    chain: moonbeam.walletClient.chain,
    nonce: moonbeam.nonceManager ? await moonbeam.nonceManager.next() : undefined,
    to: sovereignAccount,
    value
  });
  await moonbeam.publicClient.waitForTransactionReceipt({ hash });
  const balance = await moonbeam.publicClient.getBalance({ address: sovereignAccount });
  return { funded: true, balance };
}

export async function dryRunMoonbeamExecutionMessage(moonbeamApi, originParaId, encodedMessage) {
  const message = createTypeWithFallback(
    moonbeamApi,
    ["XcmVersionedXcm", "VersionedXcm", "StagingXcmVersionedXcm"],
    hexToBytes(encodedMessage)
  );
  const origin = createTypeWithFallback(
    moonbeamApi,
    ["XcmVersionedLocation", "VersionedLocation", "StagingXcmVersionedLocation"],
    {
      [`V${DEFAULT_XCM_VERSION}`]: {
        parents: 1,
        interior: {
          X1: [{ Parachain: originParaId }]
        }
      }
    }
  );

  const result = await moonbeamApi.call.dryRunApi.dryRunXcm(origin, message);
  return result.toJSON ? result.toJSON() : result;
}

export async function waitForRemoteExecutionLog(publicClient, target, requestId, fromBlock) {
  const timeoutMs = Number.parseInt(process.env.XCM_RESULT_TIMEOUT_MS ?? "180000", 10);
  const pollMs = Number.parseInt(process.env.XCM_RESULT_POLL_MS ?? "5000", 10);
  const event = parseAbiItem(
    "event RemoteExecutionRecorded(address indexed caller, bytes32 indexed requestId, bytes32 indexed memo)"
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const logs = await publicClient.getLogs({
      address: getAddress(target),
      event,
      args: { requestId },
      fromBlock
    });
    if (logs.length > 0) {
      return logs[0];
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(
    "Timed out waiting for Moonbeam execution log. The XCM may still be pending or the destination origin may need fee funding."
  );
}
