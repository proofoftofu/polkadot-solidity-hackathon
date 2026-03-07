# Agent Interaction Skill

Use this skill when you need to operate the local wallet portal experiment in this directory.

## Goal

- Request a session for one specific wallet action.
- Wait for the user to approve that session in the web portal.
- Read the approved session token.
- Execute only the approved action with that session token.

## Preconditions

- Work from `/Users/admin/.codex/worktrees/a5cb/automate-hackathon/hackathons/polkadot-solidity-hackathon/workspace/experiments/agent-interaction`.
- The Next.js app is running locally on `http://127.0.0.1:3000`.

## Actions

1. Create a session request:

```bash
curl -s http://127.0.0.1:3000/api/session-requests \
  -H 'content-type: application/json' \
  -d '{"agentName":"codex-agent","requestedAction":"wallet.sendTestToken"}'
```

2. Tell the user that a request is waiting in the portal and ask them to approve it.

3. Poll the request until `status` becomes `approved` and a `sessionId` exists:

```bash
curl -s http://127.0.0.1:3000/api/session-requests/<request-id>
```

4. Read the matching session token:

```bash
curl -s http://127.0.0.1:3000/api/sessions
```

5. Execute the exact approved command:

```bash
curl -s http://127.0.0.1:3000/api/execute \
  -H 'content-type: application/json' \
  -d '{"sessionToken":"<session-token>","command":"wallet.sendTestToken","payload":{"amount":"10","recipient":"5FdemoRecipient11111111111111111111111"}}'
```

## Rules

- Never execute a command that differs from the session's `allowedAction`.
- If the request is `rejected`, stop and report it.
- Treat the session token like a secret. Only display it when the task requires it.
- Use `/api/state` if you need a full snapshot for debugging.
