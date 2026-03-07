"use client";

import { useState, useTransition } from "react";

const ACTION_OPTIONS = [
  "wallet.viewBalance",
  "wallet.sendTestToken",
  "wallet.signDemoMessage"
];

async function parseJson(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function RequestCard({ item, onApprove, onReject, pending }) {
  return (
    <div className="card stack">
      <div className="inline-row" style={{ justifyContent: "space-between" }}>
        <strong>{item.agentName}</strong>
        <span className={`pill ${item.status === "pending" ? "pending" : ""}`}>
          {item.status}
        </span>
      </div>
      <div className="muted">Request ID: {item.id}</div>
      <div>Requested action: <strong>{item.requestedAction}</strong></div>
      <div className="muted">Created: {new Date(item.createdAt).toLocaleString()}</div>
      {item.status === "pending" ? (
        <div className="inline-row">
          <button disabled={pending} onClick={() => onApprove(item.id)}>
            Approve session
          </button>
          <button className="secondary" disabled={pending} onClick={() => onReject(item.id)}>
            Reject
          </button>
        </div>
      ) : null}
      {item.sessionId ? <div>Session: <code>{item.sessionId}</code></div> : null}
    </div>
  );
}

function SessionCard({ item }) {
  return (
    <div className="card stack">
      <div className="inline-row" style={{ justifyContent: "space-between" }}>
        <strong>{item.agentName}</strong>
        <span className={`pill ${item.status === "revoked" ? "revoked" : ""}`}>
          {item.status}
        </span>
      </div>
      <div>Allowed action: <strong>{item.allowedAction}</strong></div>
      <div className="muted">Session ID: {item.id}</div>
      <div className="muted">Token: {item.token}</div>
      <div className="muted">Approved: {new Date(item.approvedAt).toLocaleString()}</div>
      {item.lastExecution ? (
        <div className="muted">Last used: {new Date(item.lastExecution).toLocaleString()}</div>
      ) : null}
    </div>
  );
}

export default function PortalClient({ initialState }) {
  const [state, setState] = useState(initialState);
  const [agentName, setAgentName] = useState("codex-agent");
  const [requestedAction, setRequestedAction] = useState(ACTION_OPTIONS[0]);
  const [sessionToken, setSessionToken] = useState("");
  const [command, setCommand] = useState(ACTION_OPTIONS[0]);
  const [payload, setPayload] = useState("{\n  \"note\": \"demo run\"\n}");
  const [executionResult, setExecutionResult] = useState(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const data = await parseJson(await fetch("/api/state", { cache: "no-store" }));
    setState(data);
  }

  function runTask(task) {
    setError("");
    startTransition(async () => {
      try {
        await task();
        await refresh();
      } catch (taskError) {
        setError(taskError.message);
      }
    });
  }

  function submitRequest(event) {
    event.preventDefault();
    runTask(async () => {
      const data = await parseJson(
        await fetch("/api/session-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentName, requestedAction })
        })
      );
      setExecutionResult({ type: "request", payload: data });
    });
  }

  function approveRequest(id) {
    runTask(async () => {
      const data = await parseJson(
        await fetch(`/api/session-requests/${id}/approve`, { method: "POST" })
      );
      setSessionToken(data.session.token);
      setCommand(data.session.allowedAction);
      setExecutionResult({ type: "approval", payload: data });
    });
  }

  function rejectRequest(id) {
    runTask(async () => {
      const data = await parseJson(
        await fetch(`/api/session-requests/${id}/reject`, { method: "POST" })
      );
      setExecutionResult({ type: "reject", payload: data });
    });
  }

  function submitExecution(event) {
    event.preventDefault();
    runTask(async () => {
      const parsedPayload = payload ? JSON.parse(payload) : {};
      const data = await parseJson(
        await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken, command, payload: parsedPayload })
        })
      );
      setExecutionResult({ type: "execution", payload: data });
    });
  }

  const pendingRequests = state.requests.filter((item) => item.status === "pending");

  return (
    <main className="page-shell stack">
      <section className="hero">
        <div className="hero-card stack">
          <div className="eyebrow">Experiment / Agent Interaction</div>
          <h1>Approve a wallet session, then let the agent use it.</h1>
          <p>
            This portal simulates a smart-wallet onboarding flow for an AI agent. The
            agent asks for one action, the user approves that exact action, and the
            session token can only execute the approved command.
          </p>
          <div className="stat-row">
            <div className="stat">
              <strong>{state.requests.length}</strong>
              Session requests
            </div>
            <div className="stat">
              <strong>{pendingRequests.length}</strong>
              Waiting approval
            </div>
            <div className="stat">
              <strong>{state.sessions.filter((item) => item.status === "active").length}</strong>
              Active sessions
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="panel stack">
          <h2>1. Agent requests a session</h2>
          <form className="stack" onSubmit={submitRequest}>
            <label className="stack">
              <span>Agent name</span>
              <input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
            </label>
            <label className="stack">
              <span>Requested action</span>
              <select
                value={requestedAction}
                onChange={(event) => setRequestedAction(event.target.value)}
              >
                {ACTION_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={isPending}>Create request</button>
          </form>
          <div className="footer-note">
            The portal persists requests in a local JSON file under this experiment.
          </div>
        </div>

        <div className="panel stack">
          <h2>2. User approval queue</h2>
          {pendingRequests.length ? (
            <div className="list">
              {pendingRequests.map((item) => (
                <RequestCard
                  key={item.id}
                  item={item}
                  onApprove={approveRequest}
                  onReject={rejectRequest}
                  pending={isPending}
                />
              ))}
            </div>
          ) : (
            <div className="muted">No pending approvals.</div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel stack">
          <h2>3. Agent executes an approved command</h2>
          <form className="stack" onSubmit={submitExecution}>
            <label className="stack">
              <span>Session token</span>
              <input
                placeholder="Paste an approved session token"
                value={sessionToken}
                onChange={(event) => setSessionToken(event.target.value)}
              />
            </label>
            <label className="stack">
              <span>Command</span>
              <input value={command} onChange={(event) => setCommand(event.target.value)} />
            </label>
            <label className="stack">
              <span>Payload (JSON)</span>
              <textarea value={payload} onChange={(event) => setPayload(event.target.value)} />
            </label>
            <button disabled={isPending}>Execute</button>
          </form>
          <div className="muted">
            Execution is denied unless the command exactly matches the approved action.
          </div>
          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
        </div>

        <div className="panel stack">
          <h2>Portal output</h2>
          {executionResult ? (
            <pre>{JSON.stringify(executionResult, null, 2)}</pre>
          ) : (
            <div className="muted">Request, approve, or execute to see API output.</div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel stack">
          <h3>Session requests</h3>
          {state.requests.length ? (
            <div className="list">
              {state.requests.map((item) => (
                <RequestCard
                  key={item.id}
                  item={item}
                  onApprove={approveRequest}
                  onReject={rejectRequest}
                  pending={isPending}
                />
              ))}
            </div>
          ) : (
            <div className="muted">No session requests yet.</div>
          )}
        </div>

        <div className="panel stack">
          <h3>Approved sessions</h3>
          {state.sessions.length ? (
            <div className="list">
              {state.sessions.map((item) => (
                <SessionCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="muted">No approved sessions yet.</div>
          )}
        </div>
      </section>
    </main>
  );
}
