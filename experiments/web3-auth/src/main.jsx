import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import process from "process";

import App from "./App";
import { AppWeb3AuthProvider } from "./web3authContext";
import "./styles.css";

if (!globalThis.global) {
  globalThis.global = globalThis;
}

if (!globalThis.process) {
  globalThis.process = process;
}

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="shell">
          <section className="hero-card">
            <p className="eyebrow">Experiment / Embedded Wallet</p>
            <h1>Startup failed</h1>
            <p className="error-panel">{String(this.state.error.message || this.state.error)}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AppWeb3AuthProvider>
        <App />
      </AppWeb3AuthProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);
