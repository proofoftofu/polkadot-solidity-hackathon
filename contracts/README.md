# Contracts Workspace

This workspace implements the MVP blockchain layer described in the hackathon docs.

## Networks

- `polkadotTestnet`
  - RPC: `https://services.polkadothub-rpc.com/testnet`
  - Chain ID: `420420417`
  - XCM precompile: `0x00000000000000000000000000000000000a0000`
- `peoplePaseo`
  - WS: `wss://people-paseo.rpc.amforc.com`
  - Para ID: `1004`
- `shibuyaAstar`
  - RPC: `https://evm.shibuya.astar.network`
  - WS: `wss://rpc.shibuya.astar.network`
  - Chain ID: `81`
  - Para ID: `2000`

## Contracts

- `WalletFactory`
- `AgentSmartWallet`
- `SessionKeyValidatorModule`
- `ExecutionModule`
- `SponsoredExecutionPaymaster`
- `CrossChainDispatcher`

The cross-chain dispatcher is wired to the real Polkadot Hub XCM precompile shape. For local tests we swap in a mock precompile and mock router. The deployed smoke test uses a real Hub-origin XCM execution to People Chain Paseo.

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

For the live deployed smoke test, these env vars are the important ones:

- `PRIVATE_KEY`
- `POLKADOT_RPC_URL` optional override
- `POLKADOT_WS_URL` required for Substrate/XCM metadata access
- `PEOPLE_PASEO_WS_URL` required for destination-chain verification
- `PEOPLE_PASEO_BENEFICIARY` optional destination account for the smoke transfer
- `PEOPLE_PASEO_PARA_ID` optional People para ID override, default `1004`
- `PEOPLE_PASEO_LOCAL_FEE_AMOUNT` optional People local fee budget, default `1000000000`
- `PEOPLE_PASEO_REMOTE_FEE_AMOUNT` optional People remote fee budget, default `1000000000`
- `SHIBUYA_RPC_URL` optional override for Astar Shibuya EVM RPC
- `SHIBUYA_WS_URL` required for Shibuya destination-chain verification
- `SHIBUYA_BENEFICIARY` optional destination account for the Shibuya smoke transfer
- `SHIBUYA_PARA_ID` optional Shibuya para ID override, default `2000`
- `SHIBUYA_LOCAL_FEE_AMOUNT` optional Shibuya local fee budget
- `SHIBUYA_REMOTE_FEE_AMOUNT` optional Shibuya remote fee budget
- `SHIBUYA_TRANSFER_AMOUNT` optional Shibuya transfer amount
- `XCM_VERSION` optional XCM version for the live payload, default `5`
- `XCM_TRANSFER_AMOUNT` amount transferred from Hub to People Chain
- `XCM_LOCAL_FEE_AMOUNT` Hub-side XCM execution fee budget
- `XCM_REMOTE_FEE_AMOUNT` People Chain fee budget
- `XCM_MIN_DISPATCHER_EVM_BALANCE` minimum native balance the dispatcher contract should hold before execute
- `SUBSTRATE_WS_RETRIES` optional retry count for Substrate WS connects
- `SUBSTRATE_WS_RETRY_DELAY_MS` optional retry backoff base in milliseconds

## Deploy

Compile first, then deploy the Hub contracts and write the People Chain smoke-test manifest:

```bash
npm run compile
npm run deploy:all
```

This writes:

- `deployments/polkadotTestnet.json`
- `deployments/peoplePaseo.json`
- `deployments/addresses.json`

## Test Deployed Flow

Run:

```bash
npm run test:deployed:xcm
```

For the Shibuya variant:

```bash
npm run test:deployed:xcm:shibuya
```

The script:

- loads the saved Hub deployment manifest
- builds a real SCALE-encoded V5 XCM transfer program
- submits a contract-origin `execute(...)` transaction through the real Hub XCM precompile
- tops up the dispatcher contract's EVM balance if needed
- polls the destination chain and checks that the beneficiary balance increased

The local unit tests still use mocks. The deployed smoke paths use the real Hub XCM precompile from the deployed contract wallet.

## Deployment outputs

- `deployments/<network>.json` stores addresses from the deploy script.
- `deployments/abi/` stores exported ABI JSON files from `scripts/export-artifacts.js`.
