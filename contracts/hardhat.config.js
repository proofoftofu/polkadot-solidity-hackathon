import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import { fileURLToPath } from "node:url";

const solcPath = fileURLToPath(new URL("./node_modules/solc/soljson.js", import.meta.url));
const POLKADOT_RPC_URL =
  process.env.POLKADOT_RPC_URL ?? "https://services.polkadothub-rpc.com/testnet";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ACCOUNTS = PRIVATE_KEY ? [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`] : [];

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
      accounts: ACCOUNTS
    }
  }
});
