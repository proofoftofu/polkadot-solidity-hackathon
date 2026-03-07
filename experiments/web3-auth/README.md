# Web3Auth experiment

Minimal React frontend for testing MetaMask Embedded Wallets / Web3Auth login flow.

## What it does

- opens the Web3Auth modal
- lets a user sign in or disconnect
- displays the returned user information and provider status

## Setup

1. Copy `.env.example` to `.env`.
2. Set `VITE_WEB3AUTH_CLIENT_ID` with the client ID from the Web3Auth dashboard.
3. Optionally set `VITE_WEB3AUTH_NETWORK` to `sapphire_devnet` or `sapphire_mainnet`.
4. Install dependencies with `npm install`.
5. Start the app with `npm run dev`.

## Verification

- `npm test`
- `npm run build`

## Notes

- The app deliberately avoids hardcoding any client ID.
- If the client ID is missing, the UI stays usable and explains what needs to be configured.
