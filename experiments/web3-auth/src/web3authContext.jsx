import { WEB3AUTH_NETWORK } from "@web3auth/modal";
import { Web3AuthProvider } from "@web3auth/modal/react";

import { resolveWeb3AuthEnv } from "./web3authConfig";

const networkMap = {
  sapphire_mainnet: WEB3AUTH_NETWORK.SAPPHIRE_MAINNET,
  sapphire_devnet: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET
};

export function AppWeb3AuthProvider({ children }) {
  const env = resolveWeb3AuthEnv(import.meta.env);

  if (!env.hasClientId) {
    return children;
  }

  const config = {
    web3AuthOptions: {
      clientId: env.clientId,
      web3AuthNetwork: networkMap[env.network]
    }
  };

  return <Web3AuthProvider config={config}>{children}</Web3AuthProvider>;
}
