const supportedNetworks = new Set(["sapphire_mainnet", "sapphire_devnet"]);

export function resolveWeb3AuthEnv(env = {}) {
  const clientId = (env.VITE_WEB3AUTH_CLIENT_ID || "").trim();
  const requestedNetwork = (env.VITE_WEB3AUTH_NETWORK || "sapphire_devnet").trim().toLowerCase();
  const network = supportedNetworks.has(requestedNetwork) ? requestedNetwork : "sapphire_devnet";

  return {
    clientId,
    network,
    hasClientId: clientId.length > 0
  };
}
