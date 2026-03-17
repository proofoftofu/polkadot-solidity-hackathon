import { chromium } from "@playwright/test";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const REQUEST_ID = process.env.REQUEST_ID;

if (!REQUEST_ID) {
  console.error(JSON.stringify({
    ok: false,
    error: "REQUEST_ID is required"
  }, null, 2));
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (message) => {
    console.log(`[browser:${message.type()}] ${message.text()}`);
  });

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.getByText(REQUEST_ID).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Approve session" }).click();
    await page.getByText(new RegExp(`\\[NOTICE\\] Approving ${REQUEST_ID} completed\\.`, "i")).waitFor({
      timeout: 120000
    });
    console.log(JSON.stringify({
      ok: true,
      requestId: REQUEST_ID
    }, null, 2));
  } finally {
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
