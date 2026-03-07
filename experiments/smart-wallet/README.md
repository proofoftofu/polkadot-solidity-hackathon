# Smart Wallet Experiment

This experiment implements the `smart-wallet` track with a local Hardhat network and an ERC-7579-shaped account/module architecture:

- ERC-7579 account config and module config interfaces
- validator-module controlled session keys for a specific agent action
- executor-module execution path
- simple ERC-4337-style `executeUserOp(...)` path
- paymaster-managed sponsorship budget

## Experiment Scope

The prototype is intentionally minimal and focuses on the policy surface that matters for the hackathon:

1. The wallet owner installs a validator module using the ERC-7579 module lifecycle.
2. The validator module stores a session key policy for one target and one selector.
3. The session key can execute the approved action directly through the validator module for the unsponsored path.
4. A mock entry point calls `executeUserOp(...)` for a sponsored path, and a separate paymaster contract deducts sponsorship budget.
5. The owner can uninstall the module and revoke that session path.

## Files

- `contracts/SmartSessionWallet.sol`: ERC-7579-style account with execution, config, module lifecycle, ERC-1271 forwarding, and a simple `executeUserOp(...)` entry-point path
- `contracts/SessionKeyValidatorModule.sol`: validator module that enforces session-key policy
- `contracts/MockExecutorModule.sol`: minimal executor module for `executeFromExecutor`
- `contracts/SimplePaymaster.sol`: sponsorship budget manager used by `executeUserOp(...)`
- `contracts/MockEntryPoint.sol`: minimal entry point used in local tests
- `contracts/MockTradeExecutor.sol`: target contract used in local tests
- `test/SmartSessionWallet.js`: Hardhat node tests for module installation, ERC-1271 forwarding, executor flow, sponsored `executeUserOp(...)`, rejection, and uninstall

## Run

```bash
npm install
npm test
```
