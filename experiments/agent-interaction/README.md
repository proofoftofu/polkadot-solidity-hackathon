# Agent Interaction Experiment

This experiment is a minimal Next.js wallet portal prototype for the `agent-interaction` brief in `docs/experiment.md`.

## What it demonstrates

- An agent can request a session for a single wallet action.
- A user can approve or reject that request in the portal UI.
- The portal issues a session token scoped to the approved action.
- The agent can execute the approved action through an API using that token.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Test

```bash
npm test
```

## Files

- `app/` contains the Next.js UI and API routes.
- `lib/portal-store.js` contains the file-backed request, approval, and execution logic.
- `skill.md` describes how an agent should interact with the running portal.
- `data/portal-state.json` is created automatically on first run.
