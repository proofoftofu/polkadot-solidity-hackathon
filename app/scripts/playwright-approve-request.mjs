import { chromium } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const REQUEST_ID = process.env.REQUEST_ID;
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;

if (!REQUEST_ID) {
  console.error(JSON.stringify({
    ok: false,
    error: "REQUEST_ID is required"
  }, null, 2));
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const page = await context.newPage();

  page.on("console", (message) => {
    console.log(`[browser:${message.type()}] ${message.text()}`);
  });
  page.on("response", async (response) => {
    if (response.status() < 400) {
      return;
    }
    const url = response.url();
    if (!url.includes("/api/requests/") && !url.includes("/agent/executions")) {
      return;
    }
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "<unavailable>";
    }
    console.log(JSON.stringify({
      type: "browser-response-error",
      url,
      status: response.status(),
      body
    }));
  });

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    if (OWNER_PRIVATE_KEY) {
      const normalizedKey = OWNER_PRIVATE_KEY.startsWith("0x") ? OWNER_PRIVATE_KEY : `0x${OWNER_PRIVATE_KEY}`;
      const owner = privateKeyToAccount(normalizedKey);
      await page.evaluate((wallet) => {
        window.localStorage.setItem("nova-owner-eoa", JSON.stringify(wallet));
      }, {
        privateKey: normalizedKey,
        address: owner.address,
        createdAt: new Date().toISOString()
      });
      await page.reload({ waitUntil: "networkidle" });
    }
    const approveButton = page.getByRole("button", { name: "Approve session" });
    await approveButton.waitFor({ timeout: 30000 });
    await approveButton.click();
    await page.getByText(new RegExp(`\\[NOTICE\\] Approving ${REQUEST_ID} completed\\.`, "i")).waitFor({
      timeout: 120000
    });
    console.log(JSON.stringify({
      ok: true,
      requestId: REQUEST_ID
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    stack: error.stack
  }, null, 2));
  process.exit(1);
});
