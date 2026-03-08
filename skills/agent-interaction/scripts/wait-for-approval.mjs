const [, , requestId, baseUrlInput] = process.argv;
const baseUrl = baseUrlInput ?? "http://127.0.0.1:3000";
const pollIntervalMs = Number.parseInt(process.env.AGENT_REQUEST_POLL_MS ?? "5000", 10);

if (!requestId || requestId === "--help" || requestId === "-h") {
  console.error("Usage: node scripts/wait-for-approval.mjs <request-id> [base-url]");
  process.exit(requestId ? 0 : 1);
}

for (;;) {
  try {
    const response = await fetch(`${baseUrl}/agent/requests/${requestId}`);
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.log(JSON.stringify({
        requestId,
        status: "waiting",
        httpStatus: response.status,
        body
      }));
    } else if (body.request?.status === "approved" && body.request?.sessionId) {
      console.log(JSON.stringify(body, null, 2));
      process.exit(0);
    } else if (body.request?.status === "rejected") {
      console.log(JSON.stringify(body, null, 2));
      process.exit(2);
    } else {
      console.log(JSON.stringify({
        requestId,
        status: body.request?.status ?? "waiting",
        sessionId: body.request?.sessionId ?? null,
        updatedAt: body.request?.updatedAt ?? null
      }));
    }
  } catch (error) {
    console.log(JSON.stringify({
      requestId,
      status: "waiting",
      error: error.message
    }));
  }

  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}
