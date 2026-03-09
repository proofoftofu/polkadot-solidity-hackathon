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
  ],
  session: [
    {
      title: "Approve rebalance session",
      meta: "The agent requests a bounded session instead of repeated per-action confirmations.",
      wallet: "Treasury Vault",
      action: "Up to 3 stablecoin swaps",
      stage: "Assembling temporary execution rights",
      expiry: "12 minutes",
      policy: "Daily limit enforced",
      log: [
        { label: "09:41", text: "Session draft created for treasury rebalance" },
        { label: "09:42", text: "Swap path simulated across 2 routes" },
        { label: "09:42", text: "Loss cap check passed under treasury policy" },
        { label: "Now", text: "Waiting for session approval" }
      ]
    },
    {
      title: "Approve billing session",
      meta: "The agent wants one short-lived session to clear scheduled vendor invoices.",
      wallet: "Billing Wallet",
      action: "Up to 5 vendor transfers",
      stage: "Verifying invoice recipients",
      expiry: "18 minutes",
      policy: "Known vendor addresses only",
      log: [
        { label: "11:03", text: "Invoice bundle loaded from schedule" },
        { label: "11:04", text: "Recipient address book matched 5 of 5 vendors" },
        { label: "11:05", text: "Aggregate cap fits monthly payment policy" },
        { label: "Now", text: "Session ready for approval" }
      ]
    },
    {
      title: "Approve bridge monitoring session",
      meta: "The agent asks for a short session to complete one pending bridge settlement if the proof finalizes.",
      wallet: "Bridge Settlement",
      action: "One bridge release + one gas top-up",
      stage: "Holding execution window for proof finalization",
      expiry: "9 minutes",
      policy: "Single destination wallet bound",
      log: [
        { label: "14:14", text: "Bridge watcher detected finalized checkpoint" },
        { label: "14:15", text: "Destination wallet matched expected treasury" },
        { label: "14:15", text: "Fallback gas reserve requirement computed" },
        { label: "Now", text: "Awaiting session approval" }
      ]
    }
  ],
  subagents: [
    {
      title: "Approve market-making session",
      meta: "Multiple narrow agents have prepared a single bounded session for review.",
      action: "12 quote updates + 3 fills",
      stage: "Coordinating sub-agent reviews",
      expiry: "8 minutes",
      subagents: [
        { name: "Risk", status: "VaR within threshold" },
        { name: "Policy", status: "Session fits delegated rules" },
        { name: "Execution", status: "Quotes staged on venue" }
      ],
      log: [
        { label: "Risk", text: "Exposure remained under per-market budget" },
        { label: "Policy", text: "Delegated rights capped to one venue and one pair" },
        { label: "Execution", text: "Dry-run orders accepted by matching engine" },
        { label: "Lead", text: "Unified session package prepared for approval" }
      ]
    },
    {
      title: "Approve recovery session",
      meta: "Sub-agents split the recovery workflow so the user approves one short rescue session instead of many steps.",
      action: "Sweep 3 dust assets into reserve",
      stage: "Collecting sub-agent confirmations",
      expiry: "6 minutes",
      subagents: [
        { name: "Asset Map", status: "Dust balances classified" },
        { name: "Gas", status: "Recovery gas cap estimated" },
        { name: "Policy", status: "Recovery flow is permitted" }
      ],
      log: [
        { label: "Asset Map", text: "Three eligible balances found across inactive accounts" },
        { label: "Gas", text: "Sweep cost fits under recovery threshold" },
        { label: "Policy", text: "No recipient deviations detected" },
        { label: "Lead", text: "Recovery session ready for approval" }
      ]
    },
    {
      title: "Approve treasury watch session",
      meta: "The main agent delegates policy, anomaly, and execution checks before asking for a short treasury watch session.",
      action: "Monitor and rebalance if threshold breaks",
      stage: "Synchronizing specialist outputs",
      expiry: "15 minutes",
      subagents: [
        { name: "Anomaly", status: "No abnormal outflows found" },
        { name: "Policy", status: "Threshold action permitted" },
        { name: "Execution", status: "Fallback rebalance path staged" }
      ],
      log: [
        { label: "Anomaly", text: "Treasury movements match expected cadence" },
        { label: "Policy", text: "Threshold-triggered rebalance is within user rules" },
        { label: "Execution", text: "Settlement route prepared with capped slippage" },
        { label: "Lead", text: "Monitoring session assembled for sign-off" }
      ]
    }
  ],
  ledger: [
    {
      title: "Approve payment ops session",
      meta: "The agent will execute only vendor payments that match your schedule policy.",
      wallet: "Operations Wallet",
      action: "4 payroll disbursements",
      stage: "Summarizing session intent for signature",
      expiry: "20 minutes",
      policy: "Known recipients only",
      log: [
        { label: "Batch 1", text: "Payroll recipients loaded from approved roster" },
        { label: "Check", text: "Bank-to-wallet funding already settled" },
        { label: "Policy", text: "Per-recipient cap validated" },
        { label: "Ready", text: "Session is queued for one signature" }
      ]
    },
    {
      title: "Approve grant payout session",
      meta: "The agent proposes a single payout session for milestone grants already marked payable.",
      wallet: "Grant Wallet",
      action: "3 milestone releases",
      stage: "Building ledger summary for approved milestones",
      expiry: "16 minutes",
      policy: "Milestone-approved recipients only",
      log: [
        { label: "Grant 01", text: "Milestone completion evidence matched record" },
        { label: "Grant 02", text: "Recipient wallet checksum verified" },
        { label: "Grant 03", text: "Release amount fits committee approval" },
        { label: "Ready", text: "Awaiting session signature" }
      ]
    },
    {
      title: "Approve rebate session",
      meta: "The agent wants one bounded session to issue a set of low-risk customer rebates.",
      wallet: "Rewards Wallet",
      action: "18 rebate payouts under cap",
      stage: "Compressing batch into a ledger-readable summary",
      expiry: "10 minutes",
      policy: "Per-user max 50 USDC",
      log: [
        { label: "Import", text: "Qualified rebate list imported from support queue" },
        { label: "Policy", text: "Each payout fits per-user reimbursement rule" },
        { label: "Fraud", text: "Duplicate-wallet scan returned clear" },
        { label: "Ready", text: "Session summary prepared for approval" }
      ]
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
  const expiry = patternNode.querySelector("[data-session-expiry]");
  const policy = patternNode.querySelector("[data-session-policy]");
  const subagentNodes = patternNode.querySelectorAll("[data-subagent-0], [data-subagent-1], [data-subagent-2]");

  function renderLogEntries(entries) {
    if (!log) {
      return;
    }

    if (!Array.isArray(entries)) {
      log.innerHTML = "";
      return;
    }

    if (log.tagName === "UL") {
      log.innerHTML = entries
        .map((entry) => `<li><strong>${entry.label}</strong> ${entry.text}</li>`)
        .join("");
      return;
    }

    log.innerHTML = entries
      .map(
        (entry) =>
          `<div class="log-entry"><span>${entry.label}</span><p>${entry.text}</p></div>`
      )
      .join("");
  }

  function renderSubagents(agents) {
    if (!subagentNodes.length || !Array.isArray(agents)) {
      return;
    }

    subagentNodes.forEach((node, idx) => {
      const span = node.querySelector("span");
      const small = node.querySelector("small");
      const item = agents[idx];

      if (!item) {
        return;
      }

      span.textContent = item.name;
      small.textContent = item.status;
    });
  }

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

    if (expiry) {
      expiry.textContent = request.expiry;
    }

    if (policy) {
      policy.textContent = request.policy;
    }

    if (Array.isArray(request.log)) {
      renderLogEntries(request.log);
    }

    if (request.subagents) {
      renderSubagents(request.subagents);
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
