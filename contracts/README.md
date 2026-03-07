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
- `MockTarget` on Moonbase Alpha for the deployed smoke test

The cross-chain dispatcher is wired to the real Polkadot Hub XCM precompile shape. For local tests we swap in a mock precompile and mock Moonbeam router, while keeping the same dispatcher interface.

## Setup

Copy `.env.example` to `.env` and fill in the values you need.

Example:

```bash
cp .env.example .env
```

Hardhat and the standalone scripts now load `.env` via `dotenv`.

You can still use Hardhat config vars if you want, but `.env` is the default path:

```bash
npx hardhat vars set PRIVATE_KEY
```

For live two-chain deployment, these env vars are the important ones:

- `PRIVATE_KEY`
- `POLKADOT_RPC_URL` optional override
- `POLKADOT_WS_URL` required for Substrate/XCM metadata access
- `MOONBASE_RPC_URL` optional override
- `MOONBASE_WS_URL` required for Moonbeam runtime metadata access
- `MOONBASE_PARA_ID` optional override, default `1000`
- `XCM_VERSION` optional XCM version for the live payload, default `5`
- `XCM_FEE_WEI` optional Moonbase fee amount for `BuyExecution`
- `XCM_TRANSACT_GAS_LIMIT` optional Moonbeam EVM gas limit
- `XCM_TRANSACT_REF_TIME` optional XCM transact ref time
- `XCM_TRANSACT_PROOF_SIZE` optional XCM transact proof size
- `SUBSTRATE_WS_RETRIES` optional retry count for Substrate WS connects
- `SUBSTRATE_WS_RETRY_DELAY_MS` optional retry backoff base in milliseconds

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

That updates the Hub dispatcher allowlist to trust the deployed Moonbeam target.

## Test Deployed Flow

Run:

```bash
npm run test:deployed
```

The script:

- loads the saved Hub and Moonbeam deployment manifests
- builds a real SCALE-encoded XCM program for Moonbase Alpha
- submits a Hub dispatch transaction to the real Polkadot Hub XCM precompile-facing dispatcher
- waits for the Moonbase target event and prints the Moonbase-side transaction hash

The local unit tests still use mocks. The deployed smoke path is intended to use real XCM. If the Moonbase event never appears, the most likely issue is destination-side fee funding for the origin that executes the remote EVM call.

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
