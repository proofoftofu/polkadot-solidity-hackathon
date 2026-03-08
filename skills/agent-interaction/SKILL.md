---
name: agent-interaction
description: Interact with the local `workspace/app` wallet portal through localhost APIs. The agent persists its session key locally, waits for approval by polling until the request changes state, and executes the real Hub -> People XCM flow through the backend.
---

# Agent Interaction

Use this skill when Codex needs to operate the local wallet app over `http://127.0.0.1:3000`.

Treat localhost as a machine-local dependency. If sandboxed network access blocks `curl` to `127.0.0.1`, rerun with approval.

The scripts in this skill reuse the `viem` dependency already installed in `workspace/app`. No extra dependency is required inside `workspace/skills`.

Local persistent skill state lives in:

- `workspace/skills/agent-interaction/state/session-keys.json`

## App contract

The app exposes:

- `POST /agent/requests`
- `POST /agent/executions`
- `GET /agent/requests/<request-id>`
- `GET /agent/sessions/<session-id>`
- `POST /api/bundler/send-userop`
- `GET /api/state`

## Reuse the current session first

Before creating a new request, check whether a still-valid session key already exists for the owner.

Use:

```bash
node workspace/skills/agent-interaction/scripts/ensure-session-key.mjs <owner-address>
```

This script:

- reuses an unexpired stored session key for that owner if one exists
- otherwise generates a new session key and stores it locally
- never sends the private key to the backend

If the returned record already has a live `sessionId` and its `expiresAt` is still in the future, prefer reusing that session instead of asking for approval again.

Reuse only when all of the following still match the intended action:

- same `ownerAddress`
- same `targetChain`
- same beneficiary
- requested transfer amount is less than or equal to the stored limit
- the session is not expired or revoked

If any of those do not match, create a new request.

## Create the request

Generate a session key locally only when `ensure-session-key.mjs` did not return a reusable one. Keep the private key secret.

For existing owners, the backend now handles deployed-wallet reuse, validator rotation, and the live wallet nonce. Do not assume a fresh owner is required.

The `ownerAddress` sent in `POST /agent/requests` is authoritative. The portal approval must approve that same owner address, and the app now enforces that.

Create exactly one approval request for exactly one typed XCM action.

Example:

```bash
curl -s http://127.0.0.1:3000/agent/requests \
  -H 'content-type: application/json' \
  -d '{
    "actionType":"execute",
    "targetChain":"people-paseo",
    "ownerAddress":"<owner-address>",
    "sessionPublicKey":"<stored-or-generated-session-public-key>",
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

Poll continuously:

```bash
node workspace/skills/agent-interaction/scripts/wait-for-approval.mjs <request-id>
```

Policy:

- poll every 5 seconds by default
- do not stop just because approval takes a while
- continue polling across transient `404` or restart windows
- stop only when:
  - `status` becomes `approved` and `sessionId` exists, or
  - `status` becomes `rejected`, or
  - the user explicitly interrupts the flow

## Resolve the session

Read the approved session:

```bash
curl -s http://127.0.0.1:3000/agent/sessions/<session-id>
```

Do not print secrets. Treat any private key or token-like field as sensitive.

Persist the approved session metadata locally so the same session key can be reused later:

```bash
node workspace/skills/agent-interaction/scripts/update-session-record.mjs <session-public-key> \
  --requestId <request-id> \
  --sessionId <session-id> \
  --targetChain people-paseo \
  --expiresAt <expires-at> \
  --status approved
```

## Bootstrap with owner signature only

Ask the backend for the exact bootstrap action to perform:

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

Two valid backend responses exist:

- `prepared.kind = "bootstrap"`: first-time wallet bootstrap through EntryPoint, which returns `prepared.payloadHash`
- `prepared.kind = "owner-install"`: deployed wallet path, where the backend performs owner-side uninstall/install directly using the configured owner `PRIVATE_KEY`

If the backend returns `owner-install`, do not try to sign anything. Submit the bootstrap step directly and let the backend rotate/install the validator.

If the backend returns `bootstrap`, sign `prepared.payloadHash` locally with the owner key. Never post the private key.

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

After bootstrap or owner-install succeeds, update the local session record:

```bash
node workspace/skills/agent-interaction/scripts/update-session-record.mjs <session-public-key> \
  --sessionId <session-id> \
  --expiresAt <expires-at> \
  --status active
```

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

Keep the stored session key after success. It remains reusable until `expiresAt`, unless the user revokes or replaces it.

## Alternative bundler API

The same signing flow is exposed directly through:

- prepare bootstrap: `POST /api/bundler/send-userop` with `{ "kind":"bootstrap", "sessionId":"...", "prepareOnly":true }`
- submit bootstrap: same route with `{ "kind":"bootstrap", "sessionId":"...", "ownerSignature":"..." }`
  - for deployed wallets this may execute the owner-install path directly and return `kind = "owner-install"`
- prepare session: `POST /api/bundler/send-userop` with `{ "kind":"session", "sessionId":"...", "prepareOnly":true }`
- submit session: same route with `{ "kind":"session", "sessionId":"...", "sessionSignature":"...", "signerAddress":"..." }`

## Debug

Use `GET /api/state` only for debugging or recovery.

When the flow stalls, inspect the Next.js server logs. The app now logs request creation, approval, payload preparation, and `handleOps` submission.

## Rules

- Never skip approval.
- Never discard a still-valid session key without checking whether it can be reused.
- Never execute a different action than the approved request.
- Never continue after rejection.
- Never expose sensitive session material in the response.
- Never post owner or session private keys to the app API.
- The owner address to use is the request `ownerAddress` / `userId`, not an unrelated portal default wallet address.
- Prefer `http://127.0.0.1:3000` unless the user says otherwise.
