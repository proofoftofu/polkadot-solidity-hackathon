# Agent Wallet App

Next.js app for the Polkadot Hub AI agent wallet demo.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Notes

- The backend mirrors the latest `workspace/contracts` deployment metadata and ABI exports.
- Contract payloads are generated against the current session-key and XCM dispatcher interfaces.
- Without owner-signing credentials, wallet deployment and execution fall back to local simulation while still producing contract-aware payload drafts.
- `POST /api/bundler/send-userop` can submit bootstrap or session userOps through the deployed EntryPoint using `PRIVATE_KEY`.
