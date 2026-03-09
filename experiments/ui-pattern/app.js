const requestSets = {
  halo: [
    {
      title: "Approve USDC transfer route",
      meta: "Agent wants temporary spend approval for 15 minutes.",
      wallet: "Main Treasury",
      action: "Spend up to 120 USDC on Base",
      stage: "Mapping bridge + slippage guard",
      log: "Preparing a guarded transfer"
    },
    {
      title: "Sign NFT purchase intent",
      meta: "The agent found a floor-price match and needs a one-time buy signature.",
      wallet: "Collector Wallet",
      action: "Buy 1 asset under 0.42 ETH",
      stage: "Watching final price window",
      log: "Pricing NFT opportunity"
    },
    {
      title: "Approve vault rebalance",
      meta: "Reallocation stays inside your portfolio policy but still requires consent.",
      wallet: "Yield Vault",
      action: "Move 18% from stables to sDAI",
      stage: "Checking policy envelope",
      log: "Calculating safer allocation"
    }
  ],
  signal: [
    {
      title: "Grant swap allowance",
      meta: "Permit the agent to sign one swap transaction under your policy.",
      wallet: "Execution Wallet",
      action: "0.35 ETH max slippage protected",
      stage: "Composing approval packet",
      log: ["Aggregator quote locked", "Simulation passed", "Waiting for your authorize action"]
    },
    {
      title: "Allow gas top-up",
      meta: "Agent detected low operational balance and wants a bounded refill.",
      wallet: "Ops Wallet",
      action: "Refill 0.08 ETH from reserve",
      stage: "Checking reserve threshold",
      log: ["Reserve wallet checked", "Cap within daily rule", "User confirmation required"]
    },
    {
      title: "Authorize bridge exit",
      meta: "Permit one settlement transaction from the destination chain back to the treasury.",
      wallet: "Bridge Wallet",
      action: "Release 900 USDT on Arbitrum",
      stage: "Finalizing bridge proof",
      log: ["Exit proof validated", "Destination recipient matched", "Awaiting authorization"]
    }
  ],
  paper: [
    {
      title: "Allow recurring cloud bill",
      meta: "The agent found a known monthly vendor and is asking for bounded autopay.",
      wallet: "After 90 days",
      action: "$240 / month",
      stage: "Reviewing subscriptions and recurring spends",
      log: "Vendor confidence high"
    },
    {
      title: "Approve travel booking hold",
      meta: "The agent found the flight inside your budget and wants a temporary hold authorization.",
      wallet: "Expires in 30 minutes",
      action: "$620 ceiling",
      stage: "Holding reservation window",
      log: "Price match secured"
    },
    {
      title: "Enable team software renewal",
      meta: "The renewal is on-policy but the agent wants an explicit approval before it renews.",
      wallet: "Ends after this cycle",
      action: "$96 annual renewal",
      stage: "Checking recurring vendor trust",
      log: "Renewal date reached"
    }
  ]
};

function mountPattern(patternNode) {
  const key = patternNode.dataset.pattern;
  const requests = requestSets[key];
  let index = 0;

  const title = patternNode.querySelector("[data-title]");
  const meta = patternNode.querySelector("[data-meta]");
  const wallet = patternNode.querySelector("[data-wallet]");
  const action = patternNode.querySelector("[data-action]");
  const stage = patternNode.querySelector("[data-stage]");
  const card = patternNode.querySelector("[data-card]");
  const next = patternNode.querySelector("[data-next]");
  const approve = patternNode.querySelector("[data-approve]");
  const reject = patternNode.querySelector("[data-reject]");
  const count = patternNode.querySelector("[data-count]");
  const statusText = patternNode.querySelector(".status-text");
  const log = patternNode.querySelector("[data-log]");

  function render() {
    const request = requests[index];
    title.textContent = request.title;
    meta.textContent = request.meta;

    if (wallet) {
      wallet.textContent = request.wallet;
    }

    if (action) {
      action.textContent = request.action;
    }

    if (stage) {
      stage.textContent = request.stage;
    }

    if (statusText) {
      statusText.textContent = request.log;
    }

    if (count) {
      count.textContent = String(requests.length - index);
    }

    if (log && Array.isArray(request.log)) {
      log.innerHTML = request.log.map((item) => `<li>${item}</li>`).join("");
    }

    card.classList.remove("approved", "rejected");
  }

  function cycle() {
    index = (index + 1) % requests.length;
    render();
  }

  function mark(state) {
    card.classList.remove("approved", "rejected");
    void card.offsetWidth;
    card.classList.add(state);
    window.setTimeout(cycle, 700);
  }

  next.addEventListener("click", cycle);
  approve.addEventListener("click", () => mark("approved"));
  reject.addEventListener("click", () => mark("rejected"));

  window.setInterval(() => {
    if (stage) {
      const request = requests[index];
      const suffixes = ["...", ".", ".."];
      const tick = Math.floor(Date.now() / 900) % suffixes.length;
      stage.textContent = `${request.stage}${suffixes[tick]}`;
    }
  }, 500);

  render();
}

document.querySelectorAll("[data-pattern]").forEach(mountPattern);
