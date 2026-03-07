---
name: agent-interaction
description: Request approval-gated access to the local wallet portal experiment, wait for the user to approve or reject the session request, poll with a timeout, and execute only the approved localhost action. Use when Codex needs to interact with the local agent-interaction app running on the user's machine via localhost APIs.
---

# Agent Interaction

Treat the app as a localhost-only dependency. The portal runs on the user's machine, so sandboxed network access may fail even for `127.0.0.1`. Run the required `curl` calls with approval when sandbox access blocks them.

## Prepare the request

Create one session request for one specific wallet action.

Example:

```bash
curl -s http://127.0.0.1:3000/api/session-requests \
  -H 'content-type: application/json' \
  -d '{"agentName":"codex-agent","requestedAction":"wallet.sendTestToken"}'
```

Capture the returned request id.

## Wait for approval

Tell the user a request is waiting in the portal and that the next step will start only after approval.

Poll the request until it becomes `approved`, becomes `rejected`, or the timeout expires.

Example polling command:

```bash
curl -s http://127.0.0.1:3000/api/session-requests/<request-id>
```

Use this polling policy unless the user gives a different one:

- Poll every 5 seconds.
- Timeout after 5 minutes.
- Stop immediately if the request status becomes `rejected`.
- Stop immediately if `status` is `approved` and `sessionId` is present.

If the timeout expires, report that approval did not arrive in time and stop. Do not continue to execution without a valid approved session.

## Resolve the approved session

After approval, read the active sessions and find the session matching the approved `sessionId`.

Example:

```bash
curl -s http://127.0.0.1:3000/api/sessions
```

Treat the session token as a secret. Do not print it unless the task requires it.

## Execute the approved action

Execute only the exact approved action for that session.

Example:

```bash
curl -s http://127.0.0.1:3000/api/execute \
  -H 'content-type: application/json' \
  -d '{"sessionToken":"<session-token>","command":"wallet.sendTestToken","payload":{"amount":"10","recipient":"5FdemoRecipient11111111111111111111111"}}'
```

## Rules

- Never execute a command that differs from the session's `allowedAction`.
- Never skip the approval step.
- Never continue after rejection or timeout.
- Use `/api/state` only when a full debug snapshot is needed.
- Prefer `http://127.0.0.1:3000` unless the user confirms a different local port.
