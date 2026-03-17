import { chromium } from "@playwright/test";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function textOrNull(locator) {
  try {
    return (await locator.textContent())?.trim() ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (message) => {
    console.log(`[browser:${message.type()}] ${message.text()}`);
  });

  const summary = {};

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Initiate demo agent" }).click();
    const terminal = page.locator("text=Remote terminal").locator("..");
    await page.getByRole("button", { name: "Approve session" }).waitFor({ timeout: 30000 });
    const requestLine = await textOrNull(terminal.getByText(/\[DEMO\] Request req_[a-z0-9]+ submitted\./i).last());
    summary.requestLine = requestLine;
    summary.requestId = requestLine?.match(/req_[a-z0-9]+/)?.[0] ?? null;

    await page.getByRole("button", { name: "Approve session" }).click();
    await terminal.getByText(/\[NOTICE\] Approving req_[a-z0-9]+ completed\./i).waitFor({ timeout: 120000 });
    const approvalLine = await textOrNull(terminal.getByText(/\[NOTICE\] Approving req_[a-z0-9]+ completed\./i).last());
    summary.approvalLine = approvalLine;

    const sessionChip = page.locator("button").filter({ hasText: /approved|active/i }).first();
    await sessionChip.waitFor({ timeout: 30000 });
    await sessionChip.click();

    const sessionModal = page.getByText("Session detail").locator("..").locator("..");
    await sessionModal.getByRole("button", { name: "Run live transfer" }).click();
    await sessionModal.getByText(/\[DEMO\] Live transfer submitted\./i).waitFor({ timeout: 120000 });

    const transferLine = await textOrNull(sessionModal.getByText(/\[DEMO\] Live transfer submitted\./i).last());
    const txLink = await sessionModal.locator("a[href*='blockscout-testnet.polkadot.io/tx/']").last().getAttribute("href");
    summary.transferLine = transferLine;
    summary.txLink = txLink;

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
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
