# Contracts Workspace

This workspace implements the MVP blockchain layer described in the hackathon docs.

## Networks

- `polkadotTestnet`
  - RPC: `https://services.polkadothub-rpc.com/testnet`
  - Chain ID: `420420417`
  - XCM precompile: `0x00000000000000000000000000000000000a0000`
- `moonbaseAlpha`
  - RPC: `https://rpc.api.moonbase.moonbeam.network`
  - Chain ID: `1287`
  - Explorer: `https://moonbase.moonscan.io`

## Contracts

- `WalletFactory`
- `AgentSmartWallet`
- `SessionKeyValidatorModule`
- `ExecutionModule`
- `SponsoredExecutionPaymaster`
- `CrossChainDispatcher`
- `CrossChainReceiver`

The cross-chain dispatcher is wired to the real Polkadot Hub XCM precompile shape. For local tests we swap in a mock precompile and mock Moonbeam router, while keeping the same dispatcher interface.

## Setup

Set `PRIVATE_KEY` in Hardhat config variables or as an environment variable, then use:

```bash
npx hardhat vars set PRIVATE_KEY
```

For live two-chain deployment, these env vars are the important ones:

- `PRIVATE_KEY`
- `POLKADOT_RPC_URL` optional override
- `MOONBASE_RPC_URL` optional override
- `MOONBEAM_ACCOUNT_KEY20` optional Moonbeam destination account for the Hub-side destination bytes
- `MOONBEAM_TRUSTED_RELAYER` optional address allowed to finalize the remote call in the smoke test
- `XCM_MESSAGE_PREFIX` optional message version tag

## Deploy Both Chains

Compile first, then deploy both networks with one script:

```bash
npm run compile
npm run deploy:all
```

This writes:

- `deployments/polkadotTestnet.json`
- `deployments/moonbaseAlpha.json`
- `deployments/addresses.json`

## Configure Hub

If you deploy the two chains separately, run:

```bash
npm run configure:hub
```

That updates the Hub dispatcher allowlist to trust the deployed Moonbeam receiver.

## Test Deployed Flow

Run:

```bash
npm run test:deployed
```

The script:

- loads the saved Hub and Moonbeam deployment manifests
- submits a Hub dispatch transaction to the real Polkadot Hub XCM precompile-facing dispatcher
- then completes a Moonbeam smoke execution against the deployed receiver and target contracts

The Hub leg is a real testnet transaction. The Moonbeam completion step is a trusted-relayer smoke path driven by `MOONBEAM_TRUSTED_RELAYER`, so it verifies the deployed contract path across both chains even though it does not prove end-to-end live XCM delivery by itself.

## Moonbase Alpha wallet info

Use this if you want to add the remote testnet to MetaMask manually:

- Network Name: `Moonbase Alpha`
- RPC URL: `https://rpc.api.moonbase.moonbeam.network`
- Chain ID: `1287`
- Currency Symbol: `DEV`
- Block Explorer: `https://moonbase.moonscan.io`

## Deployment outputs

- `deployments/<network>.json` stores addresses from the deploy script.
- `deployments/abi/` stores exported ABI JSON files from `scripts/export-artifacts.js`.
