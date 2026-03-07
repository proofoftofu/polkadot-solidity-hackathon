# UI Experiment

This experiment is a fresh design-only prototype for the `ui` brief in `docs/experiment.md`.

## Scope

- Implements a standalone Next.js screen focused on the frontend and UI specifications.
- Uses mocked data only.
- Covers onboarding, wallet status, permission approval, active sessions, and execution history.
- Emphasizes a supportive companion-style interface instead of a developer dashboard.

## What it demonstrates

- A friendly onboarding and wallet portal surface.
- A permission approval card that explains scope in plain language first and technical detail second.
- Clear visibility for source chain, destination chain, target contract, selector, expiry, and sponsorship.
- Session and execution panels that help a demo audience understand the safety model quickly.

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

- `app/page.js` renders the design prototype.
- `app/globals.css` contains the visual system and responsive layout.
- `lib/mock-data.js` provides the static UI state.
- `tests/mock-data.test.mjs` verifies the mocked approval and execution data shape.
