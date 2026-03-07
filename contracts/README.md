# Contracts Workspace

This workspace is the Polkadot Hub wallet and XCM execution layer for the hackathon app.

It currently supports:
- deterministic wallet deployment with `CREATE2`
- first-userOp wallet bootstrap through `initCode`
- session-key permission management
- contract-origin XCM execution from Polkadot Hub Testnet to People Chain Paseo

All app-side integration should target:
- source chain: `Polkadot Hub Testnet`
- destination chain: `People Chain Paseo`

## Networks

### Polkadot Hub Testnet
- EVM RPC: `https://services.polkadothub-rpc.com/testnet`
- Substrate WS: `wss://asset-hub-paseo-rpc.n.dwellir.com`
- Chain ID: `420420417`
- XCM precompile: `0x00000000000000000000000000000000000a0000`

### People Chain Paseo
- Substrate WS: `wss://people-paseo.rpc.amforc.com`
- Para ID: `1004`

## Current deployed addresses

From `contracts/deployments/polkadotTestnet.json`:

- `EntryPoint`: `0xf1Db8323ba91C6777C8Db4B04d46A7db8861c022`
- `WalletFactory`: `0x556ba4e0062DF7cCEC1474DC51427f5a9D4fcef3`
- `SessionKeyValidatorModule`: `0x2d4385A435dA695A1eedbd75A4B880320aD26BE1`
- `ExecutionModule`: `0x4EF1ac5B6290BFB26668A736741d5aFCfedbA782`
- `SponsoredExecutionPaymaster`: `0xFE8b443A8bbee2BA29dAE9ce96664037E6ff2763`
- `CrossChainDispatcher`: `0xEf8C32456E3b0b334CcFba60923619B76525E4EA`
- `XCM precompile`: `0x00000000000000000000000000000000000a0000`

People Chain deployment metadata is in `contracts/deployments/addresses.json`:

- `paraId`: `1004`
- smoke beneficiary SS58: `15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5`

## ABI and contract entrypoints

Exported ABIs are under:
- `contracts/deployments/abi`

The main contracts the app should call are:

### WalletFactory
File:
- `contracts/contracts/WalletFactory.sol`

Use:
- `predictWallet(address owner)` to precompute the deterministic wallet address
- `createWallet(address owner)` when you want an explicit deployment transaction outside userOp flow

### AgentSmartWallet
File:
- `contracts/contracts/AgentSmartWallet.sol`

Use:
- `execute(bytes32 mode, bytes executionCalldata)` for direct owner or validator-routed execution
- `bootstrapInstallModule(...)` only through the first userOp bootstrap path
- `installModule(...)` for normal owner-driven module installation after deployment

### SessionKeyValidatorModule
File:
- `contracts/contracts/SessionKeyValidatorModule.sol`

Use:
- install as the wallet validator module
- stores session policy
- verifies session-key userOps and direct session execution

### CrossChainDispatcher
File:
- `contracts/contracts/CrossChainDispatcher.sol`

Use:
- `buildProgram((uint8,uint32,(uint8,bytes32,uint128,uint32,bytes32)[]))`
- `estimateProgramWeight((uint8,uint32,(uint8,bytes32,uint128,uint32,bytes32)[]))`
- `executeProgram(bytes32,(uint8,uint32,(uint8,bytes32,uint128,uint32,bytes32)[]))`

For raw owner-only fallback:
- `executeEncodedMessage(...)`
- `dispatchEncodedMessage(...)`

## App integration flow

The canonical end-to-end implementation for app-side integration is:
- `contracts/scripts/integration-userop-xcm.js`

If you are building the app client or another agent integration, use that file as the primary reference. It contains the full live flow:
- predict wallet
- deploy wallet through first userOp `initCode`
- install session policy in the bootstrap userOp
- fund wallet and dispatcher
- fund the dispatcher-derived Substrate account
- build the session-signed second userOp
- execute the XCM transfer through EntryPoint
- wait for the People Chain balance increase

The intended app flow is:

1. Predict wallet address with `WalletFactory.predictWallet(owner)`.
2. Submit the first userOp with `initCode` so the entry point deploys the wallet.
3. In that first userOp, call `bootstrapInstallModule(...)` to install `SessionKeyValidatorModule`.
4. Approve a session by encoding and installing the validator session policy.
5. Build a second userOp signed by the session key.
6. Execute that second userOp through `EntryPoint.handleOps(...)`.
7. The wallet executes `CrossChainDispatcher.executeProgram(...)`.
7. The dispatcher builds the XCM bytes on-chain and calls the real Hub XCM precompile.

### First userOp deployment

This is implemented and tested in:
- `contracts/contracts/mocks/MockEntryPoint.sol`
- `contracts/test/AgentSmartWallet.js`

What the app should do:
- set `sender` to the predicted wallet address
- set `initCode` to:
  - first 20 bytes: `WalletFactory` address
  - remaining bytes: ABI-encoded `createWallet(owner)`
- set `callData` to wallet `bootstrapInstallModule(...)`
- sign bootstrap userOp with the owner key

Reference code:
- bootstrap userOp builder:
  - `contracts/test/AgentSmartWallet.js`
  - `buildBootstrapUserOp(...)`

## Session permission model

Current XCM session policy supports:
- allowed XCM endpoint kinds
  - `EXECUTE`
  - `SEND`
- allowed instruction kinds
- allowed destination para IDs
- allowed beneficiaries
- allowed assets with per-asset max amounts
- remaining call count
- remaining value budget

The validator does not accept raw XCM bytes from the session key.
The session key submits a typed XCM program, and the validator checks:
- target contract is the allowed dispatcher
- called selector is allowed
- endpoint kind is allowed
- instruction kinds are allowed
- destination para is allowed
- beneficiary is allowed
- asset amount fits the configured asset cap

Reference code:
- validator policy and checks:
  - `contracts/contracts/SessionKeyValidatorModule.sol`

## Current supported XCM program

The current live-supported program is one transfer sequence:

1. `WithdrawAsset`
2. `PayFees`
3. `InitiateTransfer`
4. `DepositAsset`

The implementation is sequence-driven, not raw-byte-driven.
The dispatcher interprets the typed `instructions[]` array and encodes the message on-chain.

Reference code:
- program encoding:
  - `contracts/contracts/CrossChainDispatcher.sol`
- local XCM tests:
  - `contracts/test/CrossChainDispatcher.js`

### Typed instruction format

Each instruction is:

```solidity
struct XcmInstruction {
    uint8 kind;
    bytes32 assetId;
    uint128 amount;
    uint32 paraId;
    bytes32 accountId32;
}
```

Each program is:

```solidity
struct XcmProgram {
    uint8 endpointKind;
    uint32 endpointParaId;
    XcmInstruction[] instructions;
}
```

For People Chain transfer:
- `endpointKind = 0` (`EXECUTE`)
- `endpointParaId = 0`
- `assetId = keccak256("polkadot-hub/pas-native")`

Instruction kinds currently defined:
- `0`: `WithdrawAsset`
- `1`: `BuyExecution`
- `2`: `PayFees`
- `3`: `InitiateTransfer`
- `4`: `DepositAsset`

`BuyExecution` is defined for future expansion, but the current deployed flow uses:
- `WithdrawAsset`
- `PayFees`
- `InitiateTransfer`
- `DepositAsset`

## How to request session permission

The app should encode `SessionInstallConfig` and install it into `SessionKeyValidatorModule` through the wallet.

The important fields for XCM are:
- `allowedTarget`
  - should be the deployed `CrossChainDispatcher`
- `allowedSelector`
  - should be `executeProgram(...)`
- `operationKind`
  - `XCM_PROGRAM`
- `allowedEndpointKinds`
  - for current flow: `[EXECUTE]`
- `allowedInstructionKinds`
  - for current flow: `[WithdrawAsset, PayFees, InitiateTransfer, DepositAsset]`
- `allowedDestinationParaIds`
  - for current flow: `[1004]`
- `allowedBeneficiaries`
  - optional exact destination account restriction
- `assetLimits`
  - at least one entry for PAS with the session max amount

Reference code:
- session install payload builder:
  - `contracts/test/AgentSmartWallet.js`
  - `sessionInitData(...)`

## How the session calls XCM

The app should:

1. build the typed `XcmProgram`
2. ABI-encode `CrossChainDispatcher.executeProgram(requestId, program)`
3. wrap that in wallet single-execution calldata
4. build a session-signed userOp targeting wallet `execute(...)`
5. submit that userOp through `EntryPoint.handleOps(...)`

Reference code:
- program execution encoding:
  - `contracts/test/AgentSmartWallet.js`
  - `encodeProgramExecution(...)`
- session-signed userOp builder:
  - `contracts/scripts/integration-userop-xcm.js`
  - `buildSessionUserOp(...)`
- live deployed XCM call:
  - `contracts/scripts/test-deployed-xcm.js`
- full initCode bootstrap + session userOp integration:
  - `contracts/scripts/integration-userop-xcm.js`

## Environment

Copy:

```bash
cp .env.example .env
```

Current relevant env vars:
- `PRIVATE_KEY`
- `POLKADOT_RPC_URL`
- `POLKADOT_WS_URL`
- `PEOPLE_PASEO_WS_URL`
- `PEOPLE_PASEO_PARA_ID`
- `PEOPLE_PASEO_LOCAL_FEE_AMOUNT`
- `PEOPLE_PASEO_REMOTE_FEE_AMOUNT`
- `XCM_TRANSFER_AMOUNT`
- `XCM_MIN_DISPATCHER_EVM_BALANCE`
- `INTEGRATION_WALLET_EVM_BALANCE`
- `INTEGRATION_DISPATCHER_EVM_BALANCE`
- `INTEGRATION_DISPATCHER_DERIVED_MIN_BALANCE`
- `INTEGRATION_DISPATCHER_DERIVED_TOP_UP`

The integration script derives its own session key deterministically when `SESSION_PRIVATE_KEY` is unset.
The integration script also generates a fresh integration owner when `INTEGRATION_OWNER_PRIVATE_KEY` is unset so repeated runs can still exercise the first-userOp `initCode` deployment path.

## Commands

Local tests:

```bash
npm run test
```

Deploy contracts:

```bash
npm run deploy:all
```

Live Hub -> People XCM verification:

```bash
npm run test:deployed:xcm
```

Full userOp integration flow:

```bash
npm run test:integration:userop:xcm
```

## Current verified live behavior

Verified:
- contract-origin XCM execute from deployed dispatcher on Polkadot Hub
- destination balance increase on People Chain
- deterministic wallet deployment through `CREATE2`
- first-userOp wallet deployment through `initCode`
- session-authorized typed XCM program execution

Not currently supported:
- arbitrary raw XCM program execution by session key
- generic instruction sequences beyond the current transfer flow
