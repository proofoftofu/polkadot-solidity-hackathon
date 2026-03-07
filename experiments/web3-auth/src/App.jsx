import {
  useWeb3Auth,
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
  useWeb3AuthUser
} from "@web3auth/modal/react";

import { resolveWeb3AuthEnv } from "./web3authConfig";

function StatusPill({ tone, children }) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function MissingClientIdState({ env }) {
  return (
    <main className="shell">
      <section className="hero-card">
        <p className="eyebrow">Experiment / Embedded Wallet</p>
        <h1>Web3Auth login sandbox</h1>
        <p className="lede">
          Add a Web3Auth client ID to enable the modal and test embedded wallet sign-in.
        </p>

        <div className="meta-row">
          <StatusPill tone="warn">Client ID missing</StatusPill>
          <StatusPill tone="idle">{`Network: ${env.network}`}</StatusPill>
        </div>

        <p className="notice">
          Add `VITE_WEB3AUTH_CLIENT_ID` to a local `.env` file before running the app.
        </p>
      </section>
    </main>
  );
}

function AuthenticatedApp({ env }) {
  const { isConnected, provider, loading, initError } = useWeb3Auth();
  const { connect } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const { userInfo } = useWeb3AuthUser();

  const handleConnect = async () => {
    await connect();
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  return (
    <main className="shell">
      <section className="hero-card">
        <p className="eyebrow">Experiment / Embedded Wallet</p>
        <h1>Web3Auth login sandbox</h1>
        <p className="lede">
          This frontend opens the Web3Auth modal, lets a user authenticate, and shows the returned
          session state without any extra blockchain wiring.
        </p>

        <div className="meta-row">
          <StatusPill tone={env.hasClientId ? "ok" : "warn"}>
            {env.hasClientId ? "Client ID loaded" : "Client ID missing"}
          </StatusPill>
          <StatusPill tone={isConnected ? "ok" : "idle"}>
            {isConnected ? "Connected" : "Signed out"}
          </StatusPill>
          <StatusPill tone={loading ? "warn" : "idle"}>
            {loading ? "SDK busy" : `Network: ${env.network}`}
          </StatusPill>
        </div>

        <div className="action-row">
          <button
            className="primary-button"
            disabled={!env.hasClientId || loading || isConnected}
            onClick={handleConnect}
            type="button"
          >
            Open Web3Auth
          </button>
          <button
            className="secondary-button"
            disabled={loading || !isConnected}
            onClick={handleDisconnect}
            type="button"
          >
            Disconnect
          </button>
        </div>

        {initError ? <p className="error-panel">{String(initError.message || initError)}</p> : null}
      </section>

      <section className="details-grid">
        <article className="panel">
          <h2>User info</h2>
          <pre>{userInfo ? formatJson(userInfo) : "Sign in to inspect the returned user profile."}</pre>
        </article>

        <article className="panel">
          <h2>Provider status</h2>
          <pre>{provider ? "Provider initialized and ready for chain RPC calls." : "No provider yet."}</pre>
        </article>
      </section>
    </main>
  );
}

export default function App() {
  const env = resolveWeb3AuthEnv(import.meta.env);

  if (!env.hasClientId) {
    return <MissingClientIdState env={env} />;
  }

  return <AuthenticatedApp env={env} />;
}
