"use client";

import { useEffect, useState, useTransition } from "react";

const EMPTY_FORM = {
  summary: "Send PAS from Polkadot Hub Testnet to People Chain Paseo",
  amount: "10000000000",
  beneficiary: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48"
};

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function Section({ title, children }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function PortalClient({ initialState }) {
  const [state, setState] = useState(initialState);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ownerAddress, setOwnerAddress] = useState(initialState.wallet.ownerAddress);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

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

  const submit = (work) => {
    setMessage("");
    startTransition(async () => {
      try {
        await work();
        await refresh();
      } catch (error) {
        setMessage(error.message);
      }
    });
  };

  const createRequest = () =>
    submit(async () => {
      const body = {
        actionType: "execute",
        targetChain: "people-paseo",
        summary: form.summary,
        value: "0",
        program: {
          transferAmount: form.amount,
          beneficiary: form.beneficiary
        }
      };
      await requestJson("/agent/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setForm(EMPTY_FORM);
    });

  const deployWallet = () =>
    submit(async () => {
      await requestJson("/api/wallet/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress })
      });
    });

  const approve = (id) =>
    submit(async () => {
      await requestJson(`/api/requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress })
      });
    });

  const reject = (id) =>
    submit(async () => {
      await requestJson(`/api/requests/${id}/reject`, { method: "POST" });
    });

  const execute = (requestId, sessionId) =>
    submit(async () => {
      await requestJson("/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, sessionId })
      });
    });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Agent Wallet Portal</h1>
        <p className="text-sm text-slate-600">
          Minimal backend-first app for approval, session creation, and typed XCM execution.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Wallet">
          <label className="block text-sm">
            Owner address
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={ownerAddress}
              onChange={(event) => setOwnerAddress(event.target.value)}
            />
          </label>
          <div className="text-sm">
            <div>Status: {state.wallet.status}</div>
            <div>Predicted: {state.wallet.predictedWalletAddress ?? "Unavailable"}</div>
            <div>Deployed: {state.wallet.deployedWalletAddress ?? "Not deployed"}</div>
          </div>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            disabled={isPending}
            onClick={deployWallet}
          >
            Prepare / deploy wallet
          </button>
        </Section>

        <Section title="Create Agent Request">
          <label className="block text-sm">
            Summary
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={form.summary}
              onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
            />
          </label>
          <label className="block text-sm">
            PAS amount
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </label>
          <label className="block text-sm">
            Beneficiary AccountId32
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={form.beneficiary}
              onChange={(event) => setForm((current) => ({ ...current, beneficiary: event.target.value }))}
            />
          </label>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            disabled={isPending}
            onClick={createRequest}
          >
            Send request to backend
          </button>
        </Section>
      </div>

      {message ? <p className="mt-4 text-sm text-red-600">{message}</p> : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Section title="Pending Requests">
          {state.requests.length === 0 ? <p className="text-sm text-slate-600">No requests yet.</p> : null}
          {state.requests.map((request) => (
            <div key={request.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="font-medium">{request.summary}</div>
              <div>Status: {request.status}</div>
              <div>Target: {request.targetChainLabel}</div>
              <div>Amount: {request.explanation.primaryAmount}</div>
              <div>Beneficiary: {request.explanation.beneficiary}</div>
              <div className="mt-2 flex gap-2">
                {request.status === "pending" ? (
                  <>
                    <button className="rounded border border-slate-300 px-2 py-1" onClick={() => approve(request.id)}>
                      Approve
                    </button>
                    <button className="rounded border border-slate-300 px-2 py-1" onClick={() => reject(request.id)}>
                      Reject
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </Section>

        <Section title="Sessions">
          {state.sessions.length === 0 ? <p className="text-sm text-slate-600">No sessions yet.</p> : null}
          {state.sessions.map((session) => (
            <div key={session.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="font-medium">{session.id}</div>
              <div>Status: {session.status}</div>
              <div>Wallet: {session.walletAddress}</div>
              <div>Session key: {session.sessionPublicKey}</div>
              <div>Expires: {new Date(session.expiresAt).toLocaleString()}</div>
              <div>Request: {session.requestId}</div>
            </div>
          ))}
        </Section>

        <Section title="Executions">
          {state.executions.length === 0 ? <p className="text-sm text-slate-600">No executions yet.</p> : null}
          {state.executions.map((execution) => (
            <div key={execution.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="font-medium">{execution.id}</div>
              <div>Status: {execution.status}</div>
              <div>Route: {execution.routeType}</div>
              <div>Request: {execution.requestId}</div>
              <div>Hub tx: {execution.hubTxHash ?? "simulation"}</div>
            </div>
          ))}
        </Section>
      </div>

      <Section title="Approved Requests Ready To Execute">
        {state.requests.filter((request) => request.status === "approved" || request.status === "executed").length === 0 ? (
          <p className="text-sm text-slate-600">Approve a request first.</p>
        ) : null}
        {state.requests
          .filter((request) => request.sessionId)
          .map((request) => (
            <div key={request.id} className="flex flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{request.summary}</div>
                <div>Request: {request.id}</div>
                <div>Session: {request.sessionId}</div>
              </div>
              <button
                className="rounded border border-slate-300 px-3 py-2"
                disabled={isPending || request.status === "executed"}
                onClick={() => execute(request.id, request.sessionId)}
              >
                Execute
              </button>
            </div>
          ))}
      </Section>
    </main>
  );
}
