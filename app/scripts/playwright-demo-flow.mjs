import { chromium } from "@playwright/test";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function poll(description, fn, { timeoutMs = 180000, intervalMs = 2000 } = {}) {
  const startedAt = Date.now();
  let lastValue = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await fn();
    if (lastValue) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

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

    await page.getByTestId("initiate-demo-agent").click();
    const terminal = page.locator("text=Remote terminal").locator("..");
    await page.locator("[data-testid^='approve-session-']").first().waitFor({ timeout: 30000 });
    const sessionKeyLine = await textOrNull(
      terminal.getByText(/\[DEMO\] (Generated new|Reusing local) session key 0x[a-f0-9]+\.\s*/i).last()
    );
    summary.sessionKeyLine = sessionKeyLine;
    summary.sessionShort = sessionKeyLine?.match(/0x[a-f0-9]+\.\.\.[a-f0-9]+/i)?.[0] ?? null;
    const requestLine = await textOrNull(terminal.getByText(/\[DEMO\] Request req_[a-z0-9]+ submitted\./i).last());
    summary.requestLine = requestLine;
    summary.requestId = requestLine?.match(/req_[a-z0-9]+/)?.[0] ?? null;

    await page.locator(`[data-testid='approve-session-${summary.requestId}']`).click();
    const activeSession = await poll(
      "approved active session",
      async () => {
        const snapshot = await page.evaluate(async () => {
          const response = await fetch("/api/state");
          return response.json();
        });
        const request = snapshot.requests.find((entry) => entry.id === summary.requestId);
        if (!request?.sessionId) {
          return null;
        }
        const session = snapshot.sessions.find((entry) => entry.id === request.sessionId);
        if (!session || session.status !== "active") {
          return null;
        }
        return { request, session };
      }
    );
    summary.sessionId = activeSession.session.id;
    summary.approvalLine = `[APPROVAL] Session ${activeSession.session.id} is ready for transfer.`;

    const sessionChip = page.locator(`[data-testid='session-chip-${summary.sessionId}']`);
    await sessionChip.waitFor({ timeout: 30000 });
    await sessionChip.click();

    const sessionModal = page.locator(`[data-testid='session-modal-${summary.sessionId}']`);
    await sessionModal.waitFor({ timeout: 30000 });
    await page.locator(`[data-testid='run-live-transfer-${summary.sessionId}']`).click();
    const submittedExecution = await poll(
      "submitted execution",
      async () => {
        const snapshot = await page.evaluate(async () => {
          const response = await fetch("/api/state");
          return response.json();
        });
        return snapshot.executions.find(
          (entry) => entry.requestId === summary.requestId && entry.sessionId === summary.sessionId && entry.status === "submitted"
        ) ?? null;
      }
    );
    summary.transferLine = `[DEMO] Live transfer submitted.`;
    summary.txLink = submittedExecution.hubTxHash
      ? `https://blockscout-testnet.polkadot.io/tx/${submittedExecution.hubTxHash}`
      : null;
    summary.executionId = submittedExecution.id;

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
