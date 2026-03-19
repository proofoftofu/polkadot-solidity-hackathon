---
name: agent-interaction
description: Interact with the local `workspace/app` wallet portal through localhost APIs. The agent persists its session key locally, waits for approval by polling until the request changes state, and executes the real Hub -> People XCM flow through the backend.
---

# Agent Interaction

Use this skill when Codex needs to operate the local wallet app over `http://127.0.0.1:3000`.

Treat localhost as a machine-local dependency. If sandboxed network access blocks `curl` to `127.0.0.1`, rerun with approval.

This skill must be self-contained. Do not assume helper scripts from the repo exist when the skill is installed elsewhere.

## Preflight

Ethereum address derivation and EIP-191 signing are not practical to implement robustly with only Node built-ins. Standard Node provides secp256k1 primitives, but not the full keccak256 and recoverable-signature flow needed here.

So the operational rule is:

- check whether `viem` is available in the current workspace
- if missing, install it in the current workspace before continuing

Check:

```bash
node --input-type=module -e "import('viem/accounts').then(() => console.log('viem-ok')).catch(() => process.exit(1))"
```

If that fails:

```bash
npm install viem
```

Persistent local session state should live in a small JSON file in the current workspace, for example:

- `.agent-session-keys.json`

## App contract

The app exposes:

- `POST /agent/requests`
- `POST /agent/executions`
- `GET /agent/requests/<request-id>`
- `GET /agent/sessions/<session-id>`
- `POST /api/bundler/send-userop`
- `GET /api/state`

The supported end-to-end flow is the same one used by the local browser demo, but limited to one transaction shape:

1. create a request with `ownerAddress` and `sessionPublicKey`
2. wait for that exact owner request to be approved
3. resolve the approved session with the same `ownerAddress`
4. prepare and submit bootstrap through `POST /agent/executions`
5. prepare and submit live session execution through `POST /agent/executions`

Do not switch to a different owner namespace or a different request/session pair mid-flow.
Do not reconstruct session payloads, call data, or XCM parameters yourself when the backend already returned them.
This skill only supports the PAS transfer demo from Polkadot Hub Testnet to People Chain Paseo.

## Reuse the current session first

Before creating a new request, check whether a still-valid session key already exists for the owner in `.agent-session-keys.json`.

Use a small inline Node command to:

- read `.agent-session-keys.json` if it exists
- find an unexpired record for the owner
- reuse it if present
- otherwise generate a new session private key and derive its address with `viem`
- store the record back into `.agent-session-keys.json`

Only reuse a session when the agent has the matching local session key in `.agent-session-keys.json`.

If there is an active session on-chain but no matching local session private key is available, do not reuse that on-chain session. Register a new session key and create a new approval request.

If the returned local record already has a live `sessionId` and its `expiresAt` is still in the future, prefer reusing that session instead of asking for approval again.

Reuse only when all of the following are true:

- the agent has the local `sessionPrivateKey`
- same `ownerAddress`
- same `targetChain`
- same beneficiary
- requested transfer amount is less than or equal to the stored limit
- the session is not expired or revoked

If any of those do not match, create a new request with a new session public key.
Do not reuse an old approved session if the approved request was for a different session public key or a different transfer shape.

## Create the request

Generate a session key locally only when there is no reusable saved record for this exact owner and transfer shape. Keep the private key secret.

For existing owners, the backend now handles deployed-wallet reuse, validator rotation, and the live wallet nonce. Do not assume a fresh owner is required.

But the session key rule is strict:

- local session key present: reuse is allowed if policy still matches
- local session key missing: create a new session request even if a session already exists on-chain

The `ownerAddress` sent in `POST /agent/requests` is authoritative. The portal approval must approve that same owner address, and the app now enforces that.

The agent must be given `ownerAddress` by the caller. Do not assume the agent can discover it from browser localStorage or any other client-side state.
If `ownerAddress` is not provided, ask the caller for it before continuing.

Create exactly one approval request for exactly one typed XCM action.
The only supported action is the PAS transfer demo. Do not use this skill for other XCM routes or other beneficiaries.
For the demo flow, the beneficiary is the user wallet destination. If the beneficiary is not provided, ask the caller for the beneficiary wallet address before creating the request.

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
      "beneficiary":"<caller-provided-beneficiary-wallet-address>"
    }
  }'
```

Capture `request.id`.
Also capture `ownerAddress`. That is the address the user is approving for.

## Wait for approval

Tell the user there is a pending request in the portal. Do not continue until the request is approved.

Important:
- the owner shown on the request card must match the generated `ownerAddress`
- the beneficiary shown in the request must match the caller-provided beneficiary wallet address
- the portal should approve that request owner, not a different hardcoded wallet field

Poll continuously with inline Node or repeated `curl`.

Preferred pattern:

```bash
node --input-type=module -e "const requestId=process.argv[1]; const baseUrl='http://127.0.0.1:3000'; for (;;) { try { const res = await fetch(`${baseUrl}/agent/requests/${requestId}`); const body = await res.json().catch(() => ({})); if (res.ok && body.request?.status === 'approved' && body.request?.sessionId) { console.log(JSON.stringify(body, null, 2)); process.exit(0); } if (res.ok && body.request?.status === 'rejected') { console.log(JSON.stringify(body, null, 2)); process.exit(2); } console.log(JSON.stringify({ requestId, status: body.request?.status ?? 'waiting', sessionId: body.request?.sessionId ?? null })); } catch (error) { console.log(JSON.stringify({ requestId, status: 'waiting', error: error.message })); } await new Promise((resolve) => setTimeout(resolve, 5000)); }" <request-id>
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

Persist the approved session metadata back into `.agent-session-keys.json` so the same session key can be reused later.

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
node --input-type=module -e "import { privateKeyToAccount } from 'viem/accounts'; const pk=process.argv[1].startsWith('0x') ? process.argv[1] : `0x${process.argv[1]}`; const payloadHash=process.argv[2]; const account=privateKeyToAccount(pk); const signature=await account.signMessage({ message: { raw: payloadHash } }); console.log(JSON.stringify({ address: account.address, payloadHash, signature }));" <owner-private-key> <bootstrap-payload-hash>
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

After bootstrap or owner-install succeeds, update `.agent-session-keys.json` with `sessionId`, `expiresAt`, and `status: active`.

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
node --input-type=module -e "import { privateKeyToAccount } from 'viem/accounts'; const pk=process.argv[1].startsWith('0x') ? process.argv[1] : `0x${process.argv[1]}`; const payloadHash=process.argv[2]; const account=privateKeyToAccount(pk); const signature=await account.signMessage({ message: { raw: payloadHash } }); console.log(JSON.stringify({ address: account.address, payloadHash, signature }));" <session-private-key> <session-payload-hash>
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

## Match the browser demo

The agent flow must match the local browser demo exactly:

- request payload:
  - `actionType: "execute"`
  - `targetChain: "people-paseo"`
  - `ownerAddress: "<caller-provided-owner-address>"`
  - `sessionPublicKey: "<agent-session-public-key>"`
  - `summary: "Send PAS from Polkadot Hub Testnet to People Chain Paseo"`
  - `value: "0"`
  - `program.transferAmount: "10000000000"`
  - `program.beneficiary: "<caller-provided-beneficiary-wallet-address>"`
- approval should be read back from `/agent/requests/<request-id>?ownerAddress=...`
- session resolution must use `/agent/sessions/<session-id>?ownerAddress=...`
- bootstrap and live execution must come from `/agent/executions`
- the session signature must be made from `prepared.payloadHash` returned by the backend
- the agent must not invent a different XCM payload or different beneficiary/amount when running the demo flow
- if the backend returns a prepared payload that differs from the demo values above, stop and treat that as a mismatch rather than modifying the payload locally

If the browser demo works and the skill does not, treat that as a bug in the skill instructions or the agent-side sequence, not as permission to change the payload shape.

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
- The owner address to use is the request `ownerAddress`, not an unrelated portal default wallet address.
- If `beneficiary` is not provided by the caller, ask for it before creating the request.
- Never use `POST /api/bundler/send-userop` for the demo path unless you are debugging a backend issue.
- Prefer `http://127.0.0.1:3000` unless the user says otherwise.
