"use client";

import { useEffect, useState } from "react";

const EMPTY_FORM = {
  summary: "Send PAS from Polkadot Hub Testnet to People Chain Paseo",
  amount: "10000000000",
  beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
};

const DEMO_SESSION_STORAGE_KEY = "nova-demo-session-keys";

const CHIP_POSITIONS = [
  "left-4 top-6 md:left-10 md:top-10",
  "right-4 top-10 md:right-10 md:top-16",
  "left-8 bottom-8 md:left-16 md:bottom-14",
  "right-6 bottom-10 md:right-20 md:bottom-16"
];

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function fmtDate(value) {
  if (!value) {
    return "Unknown";
  }
  return new Date(value).toLocaleString();
}

function shortHash(value, start = 8, end = 6) {
  if (!value || value.length < start + end + 2) {
    return value ?? "Unknown";
  }
  return `${value.slice(0, start + 2)}...${value.slice(-end)}`;
}

function buildConsoleLines(state, actionLabel, message) {
  const lines = [];

  if (actionLabel) {
    lines.push({ tone: "info", text: `[ACTION] ${actionLabel}` });
  }
  if (message) {
    lines.push({
      tone: message.endsWith("completed.") ? "success" : "error",
      text: `[NOTICE] ${message}`
    });
  }

  for (const request of state.requests.filter((entry) => entry.status === "pending")) {
    lines.push({
      tone: "warning",
      text: `[APPROVAL] ${request.id} · ${request.summary} · owner ${shortHash(request.userId, 8, 8)}`
    });
  }

  for (const session of state.sessions) {
    lines.push({
      tone: session.status === "active" ? "success" : "info",
      text: `[SESSION:${session.status.toUpperCase()}] ${session.id} · ${shortHash(session.sessionPublicKey)} · ${fmtDate(session.expiresAt)}`
    });
  }

  for (const execution of state.executions) {
    lines.push({
      tone: "success",
      text: `[EXECUTION] ${execution.id} · ${shortHash(execution.hubTxHash ?? execution.userOpHash ?? "simulation")}`
    });
  }

  if (lines.length === 0) {
    lines.push({
      tone: "muted",
      text: "[SYSTEM] No requests or sessions yet. Start the demo agent to create the first delegate request."
    });
  }

  return lines.slice(0, 10);
}

function readDemoSessionStore() {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeDemoSessionStore(store) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(store));
}

function getReusableDemoSession(ownerAddress) {
  if (!ownerAddress) {
    return null;
  }
  const store = readDemoSessionStore();
  const saved = store[ownerAddress.toLowerCase()];
  if (!saved?.sessionPrivateKey || !saved?.sessionPublicKey || !saved?.expiresAt) {
    return null;
  }
  if (new Date(saved.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  return saved;
}

function upsertDemoSession(ownerAddress, updates) {
  if (!ownerAddress) {
    return null;
  }
  const store = readDemoSessionStore();
  const key = ownerAddress.toLowerCase();
  store[key] = {
    ...(store[key] ?? {}),
    ...updates
  };
  writeDemoSessionStore(store);
  return store[key];
}

async function createDemoSessionKeyPair() {
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const sessionPrivateKey = generatePrivateKey();
  return {
    sessionPrivateKey,
    sessionPublicKey: privateKeyToAccount(sessionPrivateKey).address
  };
}

async function signDemoPayload(sessionPrivateKey, payloadHash) {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(sessionPrivateKey);
  return account.signMessage({
    message: { raw: payloadHash }
  });
}

function pillTone(status) {
  if (status === "active" || status === "submitted" || status === "executed") {
    return "border-emerald-300/60 bg-emerald-400/15 text-emerald-100";
  }
  if (status === "pending" || status === "approved") {
    return "border-amber-300/60 bg-amber-300/15 text-amber-100";
  }
  if (status === "rejected") {
    return "border-rose-300/60 bg-rose-400/15 text-rose-100";
  }
  return "border-white/20 bg-white/10 text-white";
}

function lineTone(tone) {
  if (tone === "success") {
    return "border-emerald-400 bg-emerald-400/10 text-emerald-100";
  }
  if (tone === "warning") {
    return "border-amber-300 bg-amber-300/10 text-amber-100";
  }
  if (tone === "error") {
    return "border-rose-400 bg-rose-400/10 text-rose-100";
  }
  if (tone === "muted") {
    return "border-white/20 bg-white/5 text-slate-300";
  }
  return "border-cyan-400 bg-cyan-400/10 text-cyan-100";
}

export default function PortalClient({ initialState }) {
  const [state, setState] = useState(initialState);
  const [ownerAddress, setOwnerAddress] = useState(initialState.wallet.ownerAddress);
  const [message, setMessage] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [activeAction, setActiveAction] = useState(null);
  const [controlWindowOpen, setControlWindowOpen] = useState(false);
  const [sessionModalId, setSessionModalId] = useState(null);
  const [activeRequestIndex, setActiveRequestIndex] = useState(0);
  const [demoLogs, setDemoLogs] = useState([]);
  const [demoContext, setDemoContext] = useState(null);

  const appendDemoLog = (tone, text) => {
    setDemoLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        tone,
        text
      },
      ...current
    ].slice(0, 14));
  };

  const refresh = async () => {
    const snapshot = await requestJson("/api/state");
    setState(snapshot);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!demoContext?.requestId || demoContext.status !== "waiting-approval") {
      return undefined;
    }

    let stopped = false;
    const poll = async () => {
      try {
        const payload = await requestJson(`/agent/requests/${demoContext.requestId}`);
        if (stopped) {
          return;
        }
        const request = payload.request;
        if (request.status === "approved" && request.sessionId) {
          const sessionPayload = await requestJson(`/agent/sessions/${request.sessionId}`);
          appendDemoLog("success", `[DEMO] Approval confirmed for ${request.id}. Session ${request.sessionId} is now active.`);
          upsertDemoSession(request.userId, {
            ownerAddress: request.userId,
            requestId: request.id,
            sessionId: request.sessionId,
            expiresAt: sessionPayload.session.expiresAt,
            status: "approved"
          });
          setDemoContext((current) => current ? { ...current, sessionId: request.sessionId, status: "approved" } : current);
          await refresh();
          return;
        }
        if (request.status === "rejected") {
          appendDemoLog("error", `[DEMO] Request ${request.id} was rejected.`);
          setDemoContext((current) => current ? { ...current, status: "rejected" } : current);
          await refresh();
        }
      } catch (error) {
        if (!stopped) {
          appendDemoLog("error", `[DEMO] Approval polling failed: ${error.message}`);
        }
      }
    };

    const timer = setInterval(() => {
      poll().catch(() => {});
    }, 3000);

    poll().catch(() => {});

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [demoContext?.requestId, demoContext?.status]);

  const submit = async (actionKey, label, work) => {
    setMessage("");
    setActionLabel(label);
    setActiveAction(actionKey);
    try {
      await work();
      await refresh();
      setMessage(`${label} completed.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setActionLabel("");
      setActiveAction(null);
    }
  };

  const deployWallet = () =>
    submit("deploy-wallet", "Preparing wallet", async () => {
      await requestJson("/api/wallet/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress })
      });
    });

  const approve = (request) =>
    submit(`approve-${request.id}`, `Approving ${request.id}`, async () => {
      await requestJson(`/api/requests/${request.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: request.userId })
      });
    });

  const reject = (id) =>
    submit(`reject-${id}`, `Rejecting ${id}`, async () => {
      await requestJson(`/api/requests/${id}/reject`, { method: "POST" });
    });

  const execute = (requestId, sessionId) =>
    submit(`execute-${requestId}`, `Executing ${requestId}`, async () => {
      await requestJson("/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, sessionId })
      });
    });

  const initiateDemoAgent = () =>
    submit("initiate-demo", "Initiating demo agent", async () => {
      appendDemoLog("info", "[DEMO] Booting remote agent terminal.");

      let demoSession = getReusableDemoSession(ownerAddress);
      if (!demoSession) {
        const { sessionPrivateKey, sessionPublicKey } = await createDemoSessionKeyPair();
        demoSession = upsertDemoSession(ownerAddress, {
          ownerAddress,
          sessionPrivateKey,
          sessionPublicKey,
          status: "generated",
          createdAt: new Date().toISOString()
        });
        appendDemoLog("success", `[DEMO] Generated new session key ${shortHash(sessionPublicKey, 8, 8)}.`);
      } else {
        appendDemoLog("success", `[DEMO] Reusing local session key ${shortHash(demoSession.sessionPublicKey, 8, 8)}.`);
      }

      const created = await requestJson("/agent/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "execute",
          targetChain: "people-paseo",
          ownerAddress,
          sessionPublicKey: demoSession.sessionPublicKey,
          summary: EMPTY_FORM.summary,
          value: "0",
          program: {
            transferAmount: EMPTY_FORM.amount,
            beneficiary: EMPTY_FORM.beneficiary
          }
        })
      });

      upsertDemoSession(ownerAddress, {
        ...demoSession,
        requestId: created.request.id,
        status: "waiting-approval"
      });
      setDemoContext({
        ownerAddress,
        requestId: created.request.id,
        sessionId: null,
        sessionPublicKey: demoSession.sessionPublicKey,
        status: "waiting-approval"
      });
      appendDemoLog("warning", `[DEMO] Request ${created.request.id} submitted. Waiting for owner approval.`);
    });

  const runDemoTransfer = () =>
    submit("run-demo-transfer", "Running demo transfer", async () => {
      if (!demoContext?.requestId || !demoContext?.sessionId) {
        throw new Error("No approved demo session is ready");
      }
      const demoSession = getReusableDemoSession(ownerAddress);
      if (!demoSession?.sessionPrivateKey) {
        throw new Error("Local session key is missing. Start a new demo request.");
      }

      appendDemoLog("info", `[DEMO] Preparing bootstrap for ${demoContext.sessionId}.`);
      const bootstrap = await requestJson("/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: demoContext.requestId,
          sessionId: demoContext.sessionId,
          live: true,
          prepare: "bootstrap"
        })
      });

      if (bootstrap.prepared.kind === "bootstrap") {
        throw new Error("This demo owner requires an owner signature path that is not exposed in the frontend");
      }

      await requestJson("/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: demoContext.requestId,
          sessionId: demoContext.sessionId,
          live: true,
          submit: "bootstrap"
        })
      });
      appendDemoLog("success", `[DEMO] Session ${demoContext.sessionId} installed on wallet.`);

      const preparedSession = await requestJson("/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: demoContext.requestId,
          sessionId: demoContext.sessionId,
          live: true,
          prepare: "session"
        })
      });
      appendDemoLog("info", `[DEMO] Signing live payload ${shortHash(preparedSession.prepared.payloadHash, 8, 8)}.`);

      const sessionSignature = await signDemoPayload(
        demoSession.sessionPrivateKey,
        preparedSession.prepared.payloadHash
      );

      const submitted = await requestJson("/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: demoContext.requestId,
          sessionId: demoContext.sessionId,
          live: true,
          submit: "session",
          signerAddress: demoSession.sessionPublicKey,
          sessionSignature
        })
      });

      appendDemoLog("success", `[DEMO] Live transfer submitted ${shortHash(submitted.execution.hubTxHash, 8, 8)}.`);
      setDemoContext((current) => current ? { ...current, executionId: submitted.execution.id, status: "submitted" } : current);
      await refresh();
    });

  const pendingRequests = state.requests.filter((request) => request.status === "pending");
  const activeRequest = pendingRequests.length
    ? pendingRequests[activeRequestIndex % pendingRequests.length]
    : null;
  const stageSessions = state.sessions.filter((session) => session.status === "active" || session.status === "approved");
  const selectedSession = state.sessions.find((session) => session.id === sessionModalId) ?? null;
  const consoleLines = [...demoLogs, ...buildConsoleLines(state, actionLabel, message)].slice(0, 14);
  const isRunning = (actionKey) => activeAction === actionKey;

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(64,182,255,0.18),_transparent_18%),linear-gradient(180deg,_#06111b_0%,_#081723_34%,_#0d1d2b_100%)] px-4 py-4 text-white md:px-8 md:py-6">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(173,216,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(173,216,255,0.05)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="flex items-center justify-between rounded-[1.6rem] border border-white/10 bg-white/6 px-4 py-3 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl md:px-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 shadow-[0_0_40px_rgba(56,189,248,0.18)]" />
            <div>
              <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/70">
                AI Agent Session Layer
              </p>
              <h1 className="mt-1 text-lg font-semibold tracking-[0.04em] md:text-xl">NOVA / Wallet Delegation Console</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 md:block">
              {state.wallet.status}
            </div>
            <button
              className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:bg-emerald-300/16 disabled:opacity-50"
              disabled={isRunning("initiate-demo")}
              onClick={initiateDemoAgent}
              type="button"
            >
              {isRunning("initiate-demo") ? "Initiating..." : "Initiate demo agent"}
            </button>
            <button
              className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:-translate-y-0.5 hover:bg-cyan-300/16 disabled:opacity-50"
              onClick={() => setControlWindowOpen(true)}
              type="button"
            >
              Control window
            </button>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_360px]">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-3 shadow-[0_24px_100px_rgba(0,0,0,0.22)] backdrop-blur-xl md:p-4">
            <div className="relative min-h-[560px] overflow-hidden rounded-[1.7rem] border border-white/10 bg-[radial-gradient(circle_at_50%_22%,rgba(102,196,255,0.18),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(144,202,249,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(144,202,249,0.06)_1px,transparent_1px)] bg-[size:64px_64px]" />

              <div className="relative mx-auto mt-14 flex min-h-[360px] w-full max-w-[320px] flex-col items-center rounded-[160px_160px_36px_36px] border border-white/15 bg-[linear-gradient(180deg,rgba(201,238,255,0.12),rgba(255,255,255,0.04))] px-8 pb-10 pt-24 text-center shadow-[0_24px_80px_rgba(4,12,24,0.42)] backdrop-blur-xl">
                <div className="absolute inset-[-14px] rounded-[inherit] border border-cyan-300/20" />
                <div className="absolute left-1/2 top-5 h-[72px] w-[72px] -translate-x-1/2 rounded-full border border-cyan-200/20 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.7),rgba(111,214,255,0.16))] shadow-[0_0_60px_rgba(56,189,248,0.16)]" />
                <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/70">Agent</p>
                <h2 className="mt-3 text-4xl font-semibold tracking-[0.14em] text-cyan-50">NOVA</h2>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-slate-200">
                    Owner {shortHash(ownerAddress, 6, 6)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-slate-200">
                    {state.sessions.length} sessions
                  </span>
                </div>
              </div>

              {stageSessions.length === 0 ? (
              <div className="absolute inset-x-4 bottom-4 rounded-[1.4rem] border border-dashed border-white/15 bg-black/20 px-5 py-4 text-sm text-slate-300 backdrop-blur">
                  Waiting for approved delegates.
                </div>
              ) : null}

              {stageSessions.slice(0, 4).map((session, index) => (
                <button
                  key={session.id}
                  className={`absolute ${CHIP_POSITIONS[index] ?? CHIP_POSITIONS[0]} w-[172px] rounded-[1.4rem] border border-white/12 bg-white/9 p-4 text-left shadow-[0_16px_56px_rgba(2,8,18,0.36)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-white/12`}
                  onClick={() => setSessionModalId(session.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-50">
                      {session.id.replace("session_", "").slice(0, 10)}
                    </strong>
                    <span className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.16em] ${pillTone(session.status)}`}>
                      {session.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-200">
                    {shortHash(session.sessionPublicKey, 8, 8)}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                    {fmtDate(session.expiresAt)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/65">
                Approve session
              </p>
              <button
                className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-medium text-slate-200 transition hover:-translate-y-0.5 disabled:opacity-40"
                disabled={pendingRequests.length <= 1}
                onClick={() => setActiveRequestIndex((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>

            {!activeRequest ? (
              <div className="rounded-[1.8rem] border border-white/10 bg-white/6 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-slate-400">
                  Queue empty
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[0.04em] text-white">
                  No session is waiting for approval.
                </h3>
              </div>
            ) : (
              <div className="relative min-h-[420px]">
                <div className="absolute inset-x-4 top-11 h-[320px] rotate-[-6deg] rounded-[1.8rem] border border-white/8 bg-white/5" />
                <div className="absolute inset-x-4 top-7 h-[320px] rotate-[5deg] rounded-[1.8rem] border border-white/8 bg-white/6" />
                <article className="relative rounded-[1.8rem] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.07))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/70">
                    Pending signature
                  </p>
                  <h3 className="mt-3 text-[1.95rem] font-semibold leading-tight text-white">
                    {activeRequest.summary}
                  </h3>
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                      <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Owner</span>
                      <strong className="mt-1 block break-all text-sm text-slate-100">{activeRequest.userId}</strong>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                      <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Target</span>
                      <strong className="mt-1 block text-sm text-slate-100">{activeRequest.targetChainLabel}</strong>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                      <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Amount</span>
                      <strong className="mt-1 block text-sm text-slate-100">{activeRequest.explanation.primaryAmount} PAS</strong>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                      <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Beneficiary</span>
                      <strong className="mt-1 block break-all text-sm text-slate-100">{activeRequest.explanation.beneficiary}</strong>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      className="rounded-full border border-white/12 bg-white/8 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:-translate-y-0.5 disabled:opacity-50"
                      disabled={isRunning(`reject-${activeRequest.id}`)}
                      onClick={() => reject(activeRequest.id)}
                      type="button"
                    >
                      {isRunning(`reject-${activeRequest.id}`) ? "Declining..." : "Decline"}
                    </button>
                    <button
                      className="rounded-full border border-cyan-300/30 bg-cyan-300/14 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:-translate-y-0.5 hover:bg-cyan-300/18 disabled:opacity-50"
                      disabled={isRunning(`approve-${activeRequest.id}`)}
                      onClick={() => approve(activeRequest)}
                      type="button"
                    >
                      {isRunning(`approve-${activeRequest.id}`) ? "Approving..." : "Approve session"}
                    </button>
                  </div>
                </article>
              </div>
            )}
          </aside>
        </section>

        <section className="rounded-[1.8rem] border border-white/10 bg-[rgba(5,13,22,0.76)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/65">Remote terminal</p>
              <p className="mt-1 text-sm text-slate-400">Demo agent output, session flags, and execution traces.</p>
            </div>
            {demoContext?.status === "approved" ? (
              <button
                className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:bg-emerald-300/16 disabled:opacity-50"
                disabled={isRunning("run-demo-transfer")}
                onClick={runDemoTransfer}
                type="button"
              >
                {isRunning("run-demo-transfer") ? "Running transfer..." : "Run live transfer"}
              </button>
            ) : state.requests.some((request) => request.sessionId) ? (
              <div className="hidden flex-wrap gap-2 md:flex">
                {state.requests
                  .filter((request) => request.sessionId)
                  .slice(0, 3)
                  .map((request) => (
                    <button
                      key={request.id}
                      className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 transition hover:bg-white/12 disabled:opacity-50"
                      disabled={isRunning(`execute-${request.id}`) || request.status === "executed"}
                      onClick={() => execute(request.id, request.sessionId)}
                      type="button"
                    >
                      {request.status === "executed" ? "Executed" : isRunning(`execute-${request.id}`) ? "Running..." : `Run ${request.id.slice(-4)}`}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 rounded-[1.4rem] border border-white/10 bg-black/25 p-3">
            {consoleLines.map((line, index) => (
              <div
                key={`${index}-${line.text}`}
                className={`rounded-xl border-l-4 px-4 py-3 font-mono text-sm ${lineTone(line.tone)}`}
              >
                {line.text}
              </div>
            ))}
          </div>
        </section>

        {selectedSession ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6" onClick={() => setSessionModalId(null)} role="presentation">
            <div
              className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-[1.9rem] border border-white/12 bg-[linear-gradient(180deg,rgba(11,23,34,0.92),rgba(8,17,27,0.96))] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.42)] backdrop-blur-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/65">
                    Session detail
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">{selectedSession.id}</h2>
                </div>
                <button
                  className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/12"
                  onClick={() => setSessionModalId(null)}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Base wallet</p>
                  <div className="mt-3 grid gap-2 text-sm text-slate-200">
                    <div><span className="font-medium text-slate-400">Owner:</span> {selectedSession.ownerAddress}</div>
                    <div><span className="font-medium text-slate-400">Wallet:</span> {selectedSession.walletAddress}</div>
                    <div><span className="font-medium text-slate-400">Dispatcher:</span> {selectedSession.allowedTarget}</div>
                    <div><span className="font-medium text-slate-400">Validator:</span> {selectedSession.validatorAddress}</div>
                  </div>
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Delegate manager</p>
                  <div className="mt-3 grid gap-2 text-sm text-slate-200">
                    <div><span className="font-medium text-slate-400">Key:</span> {selectedSession.sessionPublicKey}</div>
                    <div><span className="font-medium text-slate-400">Status:</span> {selectedSession.status}</div>
                    <div><span className="font-medium text-slate-400">Expires:</span> {fmtDate(selectedSession.expiresAt)}</div>
                    <div><span className="font-medium text-slate-400">Beneficiary:</span> {selectedSession.allowedBeneficiaries?.[0] ?? "Unknown"}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {controlWindowOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 py-6" onClick={() => setControlWindowOpen(false)} role="presentation">
            <div
              className="max-h-[88vh] w-full max-w-4xl overflow-auto rounded-[1.9rem] border border-white/12 bg-[linear-gradient(180deg,rgba(11,23,34,0.9),rgba(7,14,23,0.96))] shadow-[0_28px_100px_rgba(0,0,0,0.42)] backdrop-blur-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-rose-400/90" />
                  <span className="h-3 w-3 rounded-full bg-amber-300/90" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400/90" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Control Window
                </p>
                <button
                  className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/12"
                  onClick={() => setControlWindowOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="p-5">
                <div className="mb-5 rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4 text-sm text-slate-300">
                  Base wallet preparation lives here. Demo session creation and live transfer are driven from the main surface through the agent terminal.
                </div>
                <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <section className="rounded-[1.6rem] border border-white/10 bg-white/6 p-5">
                      <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-100/65">
                        Wallet
                      </p>
                      <h2 className="mt-3 text-2xl font-semibold text-white">
                        Base wallet controls
                      </h2>
                      <div className="mt-5 grid gap-3">
                        <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                          <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Wallet status</span>
                          <strong className="mt-1 block text-sm text-slate-100">{state.wallet.status}</strong>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                          <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Predicted</span>
                          <strong className="mt-1 block break-all text-sm text-slate-100">{state.wallet.predictedWalletAddress ?? "Unavailable"}</strong>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3">
                          <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-slate-400">Deployed</span>
                          <strong className="mt-1 block break-all text-sm text-slate-100">{state.wallet.deployedWalletAddress ?? "Not deployed"}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-[1.6rem] border border-white/10 bg-white/6 p-5">
                      <label className="block">
                        <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.24em] text-slate-400">
                          Owner address
                        </span>
                        <input
                          className="w-full rounded-2xl border border-white/10 bg-black/16 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/30"
                          value={ownerAddress}
                          onChange={(event) => setOwnerAddress(event.target.value)}
                        />
                      </label>
                      <button
                        className="mt-4 rounded-full border border-cyan-300/30 bg-cyan-300/14 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:-translate-y-0.5 disabled:opacity-50"
                        disabled={isRunning("deploy-wallet")}
                        onClick={deployWallet}
                        type="button"
                      >
                        {isRunning("deploy-wallet") ? "Preparing..." : "Prepare wallet"}
                      </button>
                    </section>
                  </div>
              </div>
            </div>
          </div>
        ) : null}

        {message ? (
          <div
            className={`fixed bottom-4 right-4 z-40 max-w-md rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur ${
              message.endsWith("completed.")
                ? "border-emerald-300/30 bg-emerald-400/12 text-emerald-100"
                : "border-rose-300/30 bg-rose-400/12 text-rose-100"
            }`}
          >
            {message}
          </div>
        ) : null}
      </div>
    </main>
  );
}
