---
name: agent-interaction
description: Interact with the local `workspace/app` wallet portal through localhost APIs. The agent generates its own session key, requests approval for that public key, waits for approval, then executes the real Hub -> People XCM flow through the backend.
---

# Agent Interaction

Use this skill when Codex needs to operate the local wallet app over `http://127.0.0.1:3000`.

Treat localhost as a machine-local dependency. If sandboxed network access blocks `curl` to `127.0.0.1`, rerun with approval.

## App contract

The app exposes:

- `POST /agent/requests`
- `POST /agent/executions`
- `GET /agent/requests/<request-id>`
- `GET /agent/sessions/<session-id>`
- `POST /api/bundler/send-userop`
- `GET /api/state`

## Create the request

Generate a session key locally and keep the private key secret. For a clean live test run, also generate a fresh owner key so the bootstrap userOp targets a brand-new wallet.

The `ownerAddress` sent in `POST /agent/requests` is authoritative. The portal approval must approve that same owner address, and the app now enforces that.

Example key generation:

```bash
node --input-type=module -e "import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'; const ownerPrivateKey = generatePrivateKey(); const sessionPrivateKey = generatePrivateKey(); console.log(JSON.stringify({ ownerPrivateKey, ownerAddress: privateKeyToAccount(ownerPrivateKey).address, sessionPrivateKey, sessionPublicKey: privateKeyToAccount(sessionPrivateKey).address }));"
```

Create exactly one approval request for exactly one typed XCM action.

Example:

```bash
curl -s http://127.0.0.1:3000/agent/requests \
  -H 'content-type: application/json' \
  -d '{
    "actionType":"execute",
    "targetChain":"people-paseo",
    "ownerAddress":"<owner-address>",
    "sessionPublicKey":"<session-public-key>",
    "summary":"Send PAS from Polkadot Hub Testnet to People Chain Paseo",
    "program":{
      "transferAmount":"10000000000",
      "beneficiary":"0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
    }
  }'
```

Capture `request.id`.
Also capture `ownerAddress`. That is the address the user is approving for.

## Wait for approval

Tell the user there is a pending request in the portal. Do not continue until the request is approved.

Important:
- the owner shown on the request card must match the generated `ownerAddress`
- the portal should approve that request owner, not a different hardcoded wallet field

Poll:

```bash
curl -s http://127.0.0.1:3000/agent/requests/<request-id>
```

Default polling policy:

- poll every 5 seconds
- timeout after 5 minutes
- stop on `rejected`
- continue only when `status` is `approved` and `sessionId` exists

## Resolve the session

Read the approved session:

```bash
curl -s http://127.0.0.1:3000/agent/sessions/<session-id>
```

Do not print secrets. Treat any private key or token-like field as sensitive.

## Bootstrap with owner signature only

Ask the backend for the exact bootstrap payload to sign:

```bash
curl -s http://127.0.0.1:3000/agent/executions \
  -H 'content-type: application/json' \
  -d '{
    "requestId":"<request-id>",
    "sessionId":"<session-id>",
    "live":true,
    "prepare":"bootstrap"
  }'
```

This returns `prepared.payloadHash`. Sign that locally with the owner key. Never post the private key.

Example:

```bash
node workspace/skills/agent-interaction/scripts/sign-payload.mjs <owner-private-key> <bootstrap-payload-hash>
```

Submit only the signature:

```bash
curl -s http://127.0.0.1:3000/agent/executions \
  -H 'content-type: application/json' \
  -d '{
    "requestId":"<request-id>",
    "sessionId":"<session-id>",
    "live":true,
    "submit":"bootstrap",
    "ownerSignature":"<owner-signature>"
  }'
```

The session should now move to `active`.

## Execute with session signature only

Ask the backend for the exact session payload to sign:

```bash
curl -s http://127.0.0.1:3000/agent/executions \
  -H 'content-type: application/json' \
  -d '{
    "requestId":"<request-id>",
    "sessionId":"<session-id>",
    "live":true,
    "prepare":"session"
  }'
```

This returns `prepared.payloadHash` and `prepared.replayNonce`. Sign that locally with the session key:

```bash
node workspace/skills/agent-interaction/scripts/sign-payload.mjs <session-private-key> <session-payload-hash>
```

Submit only the signature:

```bash
curl -s http://127.0.0.1:3000/agent/executions \
  -H 'content-type: application/json' \
  -d '{
    "requestId":"<request-id>",
    "sessionId":"<session-id>",
    "live":true,
    "submit":"session",
    "signerAddress":"<session-public-key>",
    "sessionSignature":"<session-signature>"
  }'
```

The response should include the submitted execution with `hubTxHash` and `userOpHash`.

## Alternative bundler API

The same signing flow is exposed directly through:

- prepare bootstrap: `POST /api/bundler/send-userop` with `{ "kind":"bootstrap", "sessionId":"...", "prepareOnly":true }`
- submit bootstrap: same route with `{ "kind":"bootstrap", "sessionId":"...", "ownerSignature":"..." }`
- prepare session: `POST /api/bundler/send-userop` with `{ "kind":"session", "sessionId":"...", "prepareOnly":true }`
- submit session: same route with `{ "kind":"session", "sessionId":"...", "sessionSignature":"...", "signerAddress":"..." }`

## Debug

Use `GET /api/state` only for debugging or recovery.

When the flow stalls, inspect the Next.js server logs. The app now logs request creation, approval, payload preparation, and `handleOps` submission.

## Rules

- Never skip approval.
- Never execute a different action than the approved request.
- Never continue after rejection or timeout.
- Never expose sensitive session material in the response.
- Never post owner or session private keys to the app API.
- The owner address to use is the request `ownerAddress` / `userId`, not an unrelated portal default wallet address.
- Prefer `http://127.0.0.1:3000` unless the user says otherwise.
