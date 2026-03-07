# Cross-Chain Experiment

This experiment implements the `cross-chain` track as a minimal Hardhat harness for one-way execution from a Polkadot Hub sender contract to a Moonbeam receiver contract.

The setup is intentionally narrow:

- the sender contract lives on the Hub side
- the receiver contract lives on the Moonbeam side
- the Hub sender calls an XCM precompile-compatible interface
- a local mock precompile and router simulate cross-chain delivery
- the Moonbeam receiver only accepts execution routed through that XCM path

## What this proves

The local test harness proves the application contract boundary we need for the hackathon:

1. A Hub contract can package a remote call and submit it through an `IXcm.send(...)` interface.
2. A Moonbeam-side contract can restrict execution to an XCM delivery path.
3. The remote logic executes on Moonbeam, not on the Hub sender.

## What this does not prove

This repo does not yet contain the chain-specific SCALE XCM builder needed for a live Polkadot Hub to Moonbeam testnet delivery. The docs in this repo confirm the Hub precompile entrypoint and Hardhat network setup, but they do not provide the exact Moonbeam-side XCM executor/origin configuration or a ready-made SCALE payload builder.

Because of that, this experiment uses a mock precompile and a mock Moonbeam router locally while keeping the Hub contract aligned to the real precompile shape:

- `IXcm.send(bytes destination, bytes message)`
- `IXcm.weighMessage(bytes message)`

## Files

- `contracts/IXcm.sol`: Hub XCM precompile interface from the Polkadot docs shape
- `contracts/PolkadotHubXcmSender.sol`: Hub-side sender that packages and sends a Moonbeam call
- `contracts/MoonbeamRemoteExecutor.sol`: Moonbeam-side receiver that executes logic only through the trusted XCM route
- `contracts/MockXcmPrecompile.sol`: local replacement for the Hub precompile
- `contracts/MockMoonbeamXcmRouter.sol`: local relay that simulates Moonbeam-side XCM delivery
- `test/CrossChainXcm.js`: executable tests for hub-to-moonbeam delivery, route validation, and unauthorized direct calls
- `scripts/encodeMoonbeamDestination.js`: helper for encoding a simplified destination blob used by this experiment

## Run

This experiment uses the same Hardhat dependency set as the existing `smart-wallet` experiment.

```bash
npm install
npm run compile
npm test
```

## Mapping to the real networks

Use the local contracts as the application-layer scaffold:

1. Deploy `MoonbeamRemoteExecutor` to the Moonbeam environment you want to target.
2. Replace the mock destination bytes with the real SCALE-encoded MultiLocation for Moonbeam.
3. Replace the mock envelope in `PolkadotHubXcmSender` with the real SCALE-encoded XCM program that buys execution on Moonbeam and dispatches the receiver call there.
4. Point the sender at the Hub XCM precompile address `0x00000000000000000000000000000000000a0000`.
5. Use the Hardhat Polkadot Hub network configuration from `docs/others/smart-contracts-dev-environments-hardhat.md`.

For this hackathon phase, the experiment is useful because it narrows the unknowns to one remaining integration problem: producing the exact live XCM bytes for Moonbeam delivery while keeping the sender and receiver contracts simple.
