"use client";

import { useEffect, useMemo, useState } from "react";

import { appState } from "../lib/mock-data";

function updateSessionStatus(sessions, id, status) {
  return sessions.map((session) => (session.id === id ? { ...session, status } : session));
}

function StatusBadge({ status }) {
  const tone = {
    pending: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    active: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    expired: "border-slate-400/20 bg-slate-400/10 text-slate-300"
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${tone[status]}`}
    >
      {status}
    </span>
  );
}

function ApprovalModal({ session, onApprove, onClose }) {
  if (!session) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-md">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-slate-950/95 p-6 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-orange-200/80">
              Session Approval
            </div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Review this session key scope
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Cross-chain information appears only here because it only matters at approval time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {[
            ["Approval chain", session.approvalChain],
            ["Target chain", session.targetChain],
            ["Target contract", session.contract],
            ["Function selector", session.selector],
            ["Permission", session.scope],
            ["Expiry", session.expiry],
            ["Value cap", session.valueCap],
            ["Sponsorship", session.sponsorship]
          ].map(([label, value]) => (
            <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                {label}
              </div>
              <div className="mt-2 text-sm leading-6 text-white">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">
          Approval installs a limited session key on Polkadot Hub. The backend can only use
          the exact contract, selector, expiry, and value cap shown above.
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onApprove}
            className="rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950"
          >
            Approve session key
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionSwitcherModal({ sessions, selectedSessionId, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-md">
      <div className="w-full max-w-5xl rounded-[32px] border border-white/10 bg-slate-950/92 p-6 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-orange-200/80">
              Sessions
            </div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Choose a session to inspect
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Select a wallet session, then return to the main detail view.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              className={`group rounded-[28px] border p-5 text-left transition duration-300 ${
                selectedSessionId === session.id
                  ? "border-orange-300/40 bg-orange-300/10 shadow-lg shadow-orange-950/10"
                  : "border-white/10 bg-white/[0.04] hover:-translate-y-1 hover:bg-white/[0.07]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">{session.agent}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                    {session.id}
                  </div>
                </div>
                <StatusBadge status={session.status} />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{session.summary}</p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Allowed selector
                </div>
                <div className="mt-2 text-sm text-white">{session.selector}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ item }) {
  const tone = {
    info: "bg-cyan-400/10 text-cyan-200 border-cyan-400/20",
    warning: "bg-amber-400/10 text-amber-200 border-amber-400/20",
    success: "bg-emerald-400/10 text-emerald-200 border-emerald-400/20"
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start gap-4">
        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_0_6px_rgba(103,232,249,0.08)]" />
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-white">{item.title}</div>
            {item.time ? (
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                {item.time}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{item.body}</p>
        </div>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${tone[item.kind]}`}>
          {item.label}
        </span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [screen, setScreen] = useState("signin");
  const [sessions, setSessions] = useState(appState.sessions);
  const [selectedSessionId, setSelectedSessionId] = useState(appState.sessions[0].id);
  const [sessionHistory, setSessionHistory] = useState(appState.sessionHistory);
  const [approvalSessionId, setApprovalSessionId] = useState(null);
  const [queuedTemplateIndex, setQueuedTemplateIndex] = useState(0);
  const [showSessionList, setShowSessionList] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0],
    [selectedSessionId, sessions]
  );
  const approvalSession = useMemo(
    () => sessions.find((session) => session.id === approvalSessionId) ?? null,
    [approvalSessionId, sessions]
  );
  const pendingSessions = useMemo(
    () => sessions.filter((session) => session.status === "pending"),
    [sessions]
  );
  const selectedHistory = useMemo(
    () => (selectedSession ? sessionHistory[selectedSession.id] ?? [] : []),
    [selectedSession, sessionHistory]
  );

  const sessionCounts = useMemo(
    () => ({
      total: sessions.length,
      pending: sessions.filter((session) => session.status === "pending").length,
      active: sessions.filter((session) => session.status === "active").length
    }),
    [sessions]
  );

  useEffect(() => {
    if (screen !== "portal" || selectedSessionId || !sessions.length) return;
    setSelectedSessionId(sessions[0].id);
  }, [screen]);

  function approveSelectedSession() {
    if (!approvalSession) {
      return;
    }

    setSessions((current) => updateSessionStatus(current, approvalSession.id, "active"));
    setSessionHistory((current) => ({
      ...current,
      [approvalSession.id]: [
        ...(current[approvalSession.id] ?? []),
        appState.activity.afterApproval(approvalSession)
      ]
    }));
    setSelectedSessionId(approvalSession.id);
    setApprovalSessionId(null);
  }

  function queueBackendSession() {
    const nextSession = appState.sessionTemplates[queuedTemplateIndex];
    if (!nextSession || sessions.length >= 3) {
      return;
    }

    setSessions((current) => [nextSession, ...current]);
    setQueuedTemplateIndex((current) => current + 1);
    setSessionHistory((current) => ({
      ...current,
      [nextSession.id]: [appState.activity.afterNewSession(nextSession)]
    }));
    setApprovalSessionId(nextSession.id);
  }

  function revokeSelectedSession() {
    if (!selectedSession) {
      return;
    }

    const sessionToRemove = selectedSession;
    const remainingSessions = sessions.filter((session) => session.id !== sessionToRemove.id);
    setSessionHistory((current) => ({
      ...current,
      [sessionToRemove.id]: [
        ...(current[sessionToRemove.id] ?? []),
        appState.activity.afterRevoke(sessionToRemove)
      ]
    }));
    setSessions(remainingSessions);

    if (remainingSessions.length > 0) {
      setSelectedSessionId(remainingSessions[0].id);
    } else {
      setSelectedSessionId(null);
    }
  }

  function openApprovalForPendingSession() {
    if (!pendingSessions.length) {
      return;
    }

    const nextPending = pendingSessions[0];
    setApprovalSessionId(nextPending.id);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.14),_transparent_24%),linear-gradient(160deg,#130f18_0%,#111827_45%,#1b1223_100%)] px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        {screen === "signin" ? (
          <section className="grid min-h-[92vh] place-items-center">
            <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-white/[0.06] p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-300 via-amber-200 to-cyan-300 text-lg font-bold text-slate-950 shadow-lg shadow-orange-500/20">
                W
              </div>
              <div className="mt-6 space-y-3 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-orange-200/80">
                  Wallet Portal
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">
                  Secure Agent Wallet Hub
                </h1>
                <p className="text-sm leading-6 text-slate-300">
                  Use the wallet normally, then manage AI session keys only when the backend
                  asks for approval.
                </p>
              </div>
              <div className="mt-8 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Sign in method
                  </div>
                  <div className="mt-2 text-sm font-medium text-white">Web3Auth embedded wallet</div>
                </div>
                <button
                  type="button"
                  onClick={() => setScreen("portal")}
                  className="w-full rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950"
                >
                  Continue with Web3Auth
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="space-y-6">
            <header className="grid gap-4 rounded-[32px] border border-white/10 bg-white/[0.05] p-6 backdrop-blur-xl xl:grid-cols-[1.2fr_0.8fr]">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.04] shadow-lg shadow-black/10">
                  <div className="flex gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-300" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-300" />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-orange-200/80">
                    Session Dashboard
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Secure Agent Wallet Hub
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    Manage wallet sessions for AI agent access. Inspect every session, approve
                    pending ones, and review how the backend used them.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Total sessions", String(sessionCounts.total)],
                  ["Pending approval", String(sessionCounts.pending)],
                  ["Active sessions", String(sessionCounts.active)]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      {label}
                    </div>
                      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
                    </div>
                  ))}
              </div>
            </header>

            {pendingSessions.length > 0 ? (
              <section className="flex flex-col gap-4 rounded-[28px] border border-amber-400/20 bg-amber-400/10 p-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200">
                    Pending approval
                  </div>
                  <p className="mt-2 text-sm leading-6 text-amber-100">
                    {pendingSessions[0].agent} is waiting for approval. You can review that session
                    without leaving the current selected session.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openApprovalForPendingSession}
                  className="rounded-full border border-amber-300/20 bg-slate-950/30 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-slate-950/40"
                >
                  Review pending approval
                </button>
              </section>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="space-y-6">
                <section className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                        Wallet
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">{appState.wallet.address}</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {[
                      ["Owner signer", appState.wallet.owner],
                      ["Home chain", appState.wallet.homeChain],
                      ["Wallet status", appState.wallet.status],
                      ["Backend state", appState.wallet.recentProcess]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                          {label}
                        </div>
                        <div className="mt-2 text-sm font-medium text-white">{value}</div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={queueBackendSession}
                    disabled={
                      queuedTemplateIndex >= appState.sessionTemplates.length || sessions.length >= 3
                    }
                    className="mt-4 w-full rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    {sessions.length >= 3
                      ? "Maximum 3 live sessions"
                      : queuedTemplateIndex >= appState.sessionTemplates.length
                        ? "No more mock requests"
                        : "Simulate backend request"}
                  </button>
                </section>
              </aside>

              <div className="space-y-6">
                <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.05] p-6 backdrop-blur-xl">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-orange-300/10 via-cyan-300/5 to-transparent" />
                  <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                        Selected session
                      </div>
                      <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                        {selectedSession ? selectedSession.agent : "No live sessions"}
                      </h3>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                        {selectedSession
                          ? selectedSession.userFriendly
                          : "Revoked or expired sessions are removed from the dashboard list."}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowSessionList(true)}
                        disabled={!sessions.length}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        Show sessions
                      </button>
                      {selectedSession ? <StatusBadge status={selectedSession.status} /> : null}
                    </div>
                  </div>

                  {selectedSession ? (
                    <>
                      <div className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
                        <div className="space-y-4">
                          <div className="rounded-[28px] border border-white/10 bg-slate-950/40 p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                  Session overview
                                </div>
                                <div className="mt-2 text-3xl font-semibold tracking-tight text-white">
                                  {selectedSession.agent}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                  Session ID
                                </div>
                                <div className="mt-2 text-sm font-medium text-white">{selectedSession.id}</div>
                              </div>
                            </div>

                            <div className="mt-5 grid gap-4 md:grid-cols-2">
                              {[
                                ["Allowed contract", selectedSession.contract],
                                ["Allowed selector", selectedSession.selector],
                                ["Permission scope", selectedSession.scope],
                                ["Expiry", selectedSession.expiry],
                                ["Value cap", selectedSession.valueCap],
                                [
                                  "Target chain",
                                  selectedSession.status === "pending"
                                    ? "Shown during approval"
                                    : selectedSession.targetChain
                                ]
                              ].map(([label, value]) => (
                                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                    {label}
                                  </div>
                                  <div className="mt-2 text-sm leading-6 text-white">{value}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                              Backend handling
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-300">
                              The backend stores this session key, waits for approval, and records when
                              it is used. Cross-chain routing is only exposed during approval.
                            </p>
                          </div>
                        </div>
                      <div className="rounded-[28px] border border-white/10 bg-slate-950/40 p-5">
                        <div className="border-b border-white/10 pb-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                            Session key history
                          </div>
                          <h4 className="mt-2 text-lg font-semibold tracking-tight text-white">
                            Log for this session
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            Only the selected session history is shown here.
                          </p>
                        </div>

                        <div className="mt-4 grid max-h-[420px] gap-3 overflow-y-auto pr-1">
                          {selectedHistory.map((item) => (
                            <ActivityRow key={item.id} item={item} />
                          ))}
                          {!selectedHistory.length ? (
                            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
                              No history for this session yet.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={selectedSession.status !== "pending"}
                          onClick={() => setApprovalSessionId(selectedSession.id)}
                          className="rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
                        >
                          {selectedSession.status === "pending" ? "Approve session key" : "Already approved"}
                        </button>
                        <button
                          type="button"
                          disabled={selectedSession.status !== "active"}
                          onClick={revokeSelectedSession}
                          className="rounded-full border border-rose-400/20 bg-rose-400/10 px-5 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-400/15 disabled:opacity-50"
                        >
                          Revoke session key
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-6 rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] p-10 text-center">
                      <div className="text-lg font-semibold text-white">No live sessions</div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Revoked or expired sessions are removed from the dashboard list.
                      </p>
                    </div>
                  )}
                </section>

              </div>
            </div>
          </section>
        )}
      </div>

      {approvalSession ? (
        <ApprovalModal
          session={approvalSession}
          onApprove={approveSelectedSession}
          onClose={() => setApprovalSessionId(null)}
        />
      ) : null}

      {showSessionList ? (
        <SessionSwitcherModal
          sessions={sessions}
          selectedSessionId={selectedSession?.id}
          onClose={() => setShowSessionList(false)}
          onSelect={(id) => {
            setSelectedSessionId(id);
            setShowSessionList(false);
          }}
        />
      ) : null}
    </main>
  );
}
