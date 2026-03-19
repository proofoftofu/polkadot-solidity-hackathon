# Nova - Agent Hub in Polkadot Hub

## Live App
https://polkadot-solidity-hackathon.vercel.app

## Demo
https://youtu.be/u-YA3i6biiI

## Vision
Nova is an Agent Hub on Polkadot Hub for managing cross-chain actions with account abstraction and AI Agent sessions.

## What It Does
![diagram](./assets/diagram.png)

Nova lets a user create a session key for an account abstraction wallet, approve that session, and let an AI Agent operate within the granted scope. The user can define what the agent is allowed to do, including the XCM operation type, asset, target chain, and beneficiary. This keeps the wallet flexible for automation while staying under user-defined limits.

## How It Is Made
Nova is built on account abstraction using ERC4337 and IERC7579-style session and module handling to enable secure, delegated wallet interactions.

Permissions are defined at the level of each XCM operation. The user specifies exactly what actions are allowed, including operation type, asset, destination chain, and beneficiary, creating a fine-grained permission model for cross-chain execution.

These permissions are embedded into a session within an ERC4337 smart contract wallet. This session acts as a constrained access layer, allowing an AI Agent to operate the wallet within a strictly limited scope without requiring full control.

The smart contract wallet is deployed on Polkadot Hub, serving as the execution base. Through a cross-chain dispatch module and XCM-based execution, the AI Agent can perform permitted actions across connected chains such as People Chain.

All components, wallet deployment, session creation and approval, permission validation, and cross-chain execution, are unified into a single delegated flow, enabling safe automation without compromising user control.

## Rerefence

### Final XCM Tx

https://blockscout-testnet.polkadot.io/tx/0x6eef36f96d74fb30772cee203b73b207fcb24d5872248158af6d0bc4e006c695

### Sample Prompt

```
can you try agent-interaction skill to make session, and then use the session to transfer PAS to people chain?

ownerAddress: 0x651E61a3fD14bE0612e315e15A6EB3D9759Cb712
beneficiary: 0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48
```
