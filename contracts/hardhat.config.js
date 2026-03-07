import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import { fileURLToPath } from "node:url";

const solcPath = fileURLToPath(new URL("./node_modules/solc/soljson.js", import.meta.url));
const POLKADOT_RPC_URL =
  process.env.POLKADOT_RPC_URL ?? "https://services.polkadothub-rpc.com/testnet";
const MOONBASE_RPC_URL =
  process.env.MOONBASE_RPC_URL ?? "https://rpc.api.moonbase.moonbeam.network";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        path: solcPath
      },
      production: {
        version: "0.8.28",
        path: solcPath,
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    }
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1"
    },
    polkadotTestnet: {
      type: "http",
      chainType: "l1",
      url: POLKADOT_RPC_URL,
      chainId: 420420417,
      accounts: [configVariable("PRIVATE_KEY")]
    },
    moonbaseAlpha: {
      type: "http",
      chainType: "l1",
      url: MOONBASE_RPC_URL,
      chainId: 1287,
      accounts: [configVariable("PRIVATE_KEY")]
    }
  }
});
