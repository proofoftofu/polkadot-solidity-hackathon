import { privateKeyToAccount } from "../../../app/node_modules/viem/_esm/accounts/index.js";

const [, , privateKeyInput, payloadHash] = process.argv;

if (!privateKeyInput || !payloadHash) {
  console.error("Usage: node scripts/sign-payload.mjs <private-key> <payload-hash>");
  process.exit(1);
}

const privateKey = privateKeyInput.startsWith("0x") ? privateKeyInput : `0x${privateKeyInput}`;
const account = privateKeyToAccount(privateKey);
const signature = await account.signMessage({ message: { raw: payloadHash } });

console.log(JSON.stringify({ address: account.address, payloadHash, signature }));
