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
  ],
  orbitdeck: [
    {
      title: "Approve treasury rebalance session",
      meta: "NOVA requests a bounded session so it can complete several related treasury actions without asking every step.",
      action: "3 swaps + 1 settlement",
      expiry: "14 minutes",
      stage: "Managing active wallet sessions",
      floating: [
        { title: "Swap Session", status: "2 steps complete" },
        { title: "Bridge Session", status: "proof tracking" },
        { title: "Vendor Session", status: "queued behind rebalance" }
      ],
      log: [
        { label: "Treasury Rebalance", text: "Drafted session envelope with capped stablecoin routes." },
        { label: "Bridge Session", text: "Checkpoint watcher still running, no release yet." },
        { label: "Vendor Session", text: "Known invoice set held until rebalance finishes." },
        { label: "Current Ask", text: "Waiting for user approval on rebalance session." }
      ]
    },
    {
      title: "Approve liquidity defense session",
      meta: "NOVA bundles protective treasury moves into one temporary session while preserving your spend and slippage rules.",
      action: "2 hedges + 2 reserve moves",
      expiry: "11 minutes",
      stage: "Ranking active sessions by urgency",
      floating: [
        { title: "Liquidity Defense", status: "highest priority" },
        { title: "Bridge Session", status: "settlement idle" },
        { title: "Payroll Session", status: "scheduled later" }
      ],
      log: [
        { label: "Liquidity Defense", text: "Simulated protective route under loss threshold." },
        { label: "Reserve Session", text: "Fallback reserve wallet is ready if approved." },
        { label: "Bridge Session", text: "No state change since the last finality check." },
        { label: "Current Ask", text: "Approval requested for the defensive session." }
      ]
    },
    {
      title: "Approve vendor clearing session",
      meta: "NOVA wants a short session to process a cluster of known vendor charges and a retry for one failed debit.",
      action: "5 vendor payments + 1 retry",
      expiry: "19 minutes",
      stage: "Balancing active and queued sessions",
      floating: [
        { title: "Vendor Session", status: "ready to execute" },
        { title: "Rewards Session", status: "cooldown active" },
        { title: "Bridge Session", status: "watching proof" }
      ],
      log: [
        { label: "Vendor Session", text: "Recipient book matched six known vendor wallets." },
        { label: "Retry Queue", text: "One failed debit qualifies for safe retry." },
        { label: "Rewards Session", text: "Held back to stay under daily payout volume." },
        { label: "Current Ask", text: "Awaiting approval on vendor clearing session." }
      ]
    }
  ],
  atlas: [
    {
      title: "Approve payroll settlement session",
      meta: "NOVA has bundled a scheduled payment run into one session with recipient and cap guardrails.",
      wallet: "Operations Wallet",
      action: "4 salary disbursements",
      expiry: "22 minutes",
      policy: "Known recipients only",
      stage: "Reviewing all delegated sessions",
      floating: [
        { title: "Payroll", status: "2 actions left" },
        { title: "Rebalance", status: "simulated" },
        { title: "Rewards", status: "waiting" },
        { title: "Bridge Exit", status: "proof pending" }
      ],
      log: [
        { label: "Payroll", text: "Roster sync complete; all four recipients verified." },
        { label: "Rebalance", text: "Dry run complete, held until payroll window closes." },
        { label: "Rewards", text: "Queued under lower execution priority." },
        { label: "Bridge Exit", text: "No final proof yet, session remains passive." }
      ]
    },
    {
      title: "Approve rebate operations session",
      meta: "NOVA groups a set of low-risk reimbursements into one session and keeps the rest of the session board visible around it.",
      wallet: "Rewards Wallet",
      action: "18 user rebates",
      expiry: "13 minutes",
      policy: "Per-user max 50 USDC",
      stage: "Sorting sessions by policy confidence",
      floating: [
        { title: "Rebates", status: "high confidence" },
        { title: "Payroll", status: "done" },
        { title: "Subscriptions", status: "waiting" },
        { title: "Bridge Exit", status: "external finality" }
      ],
      log: [
        { label: "Rebates", text: "Duplicate-wallet scan returned clear across all payouts." },
        { label: "Subscriptions", text: "Recurring renewals stay parked for later review." },
        { label: "Payroll", text: "Last payroll session completed without deviation." },
        { label: "Bridge Exit", text: "External dependency still unresolved." }
      ]
    },
    {
      title: "Approve bridge settlement session",
      meta: "NOVA wants one short-lived settlement session while keeping other operating sessions visible in the control board.",
      wallet: "Bridge Wallet",
      action: "1 release + 1 gas top-up",
      expiry: "9 minutes",
      policy: "Destination wallet bound",
      stage: "Watching critical-path sessions",
      floating: [
        { title: "Bridge Exit", status: "ready" },
        { title: "Treasury", status: "holding" },
        { title: "Payroll", status: "next batch tomorrow" },
        { title: "Rewards", status: "budget cap reached" }
      ],
      log: [
        { label: "Bridge Exit", text: "Proof finalized and release path staged." },
        { label: "Treasury", text: "Rebalance session intentionally paused during bridge release." },
        { label: "Rewards", text: "Budget cap prevents immediate execution." },
        { label: "Control", text: "Bridge settlement is the only session requesting approval now." }
      ]
    }
  ],
  garden: [
    {
      title: "Approve subscription maintenance session",
      meta: "NOVA wants a short-lived session to cleanly process known recurring payments and retry one failed renewal.",
      wallet: "Finance Wallet",
      action: "6 recurring vendor charges",
      expiry: "30 minutes",
      policy: "Bounded by monthly budget",
      stage: "Growing and pruning active sessions",
      floating: [
        { title: "Subscriptions", status: "healthy" },
        { title: "Travel Hold", status: "window open" },
        { title: "Grant Payout", status: "awaiting consent" }
      ],
      log: [
        { label: "Subscriptions", text: "Five renewals matched known vendors and one retry is safe." },
        { label: "Travel Hold", text: "Reservation window remains open but inactive." },
        { label: "Grant Payout", text: "Milestone evidence loaded, no approval yet." },
        { label: "Current Ask", text: "Subscription maintenance session is waiting for approval." }
      ]
    },
    {
      title: "Approve travel booking session",
      meta: "NOVA found a good booking window and asks for a temporary session to hold and finalize the reservation if the price remains stable.",
      wallet: "Travel Wallet",
      action: "1 flight hold + 1 payment release",
      expiry: "17 minutes",
      policy: "Trip budget ceiling enforced",
      stage: "Reprioritizing short-lived opportunities",
      floating: [
        { title: "Travel Hold", status: "highest urgency" },
        { title: "Subscriptions", status: "deferred" },
        { title: "Grant Payout", status: "ready later" }
      ],
      log: [
        { label: "Travel Hold", text: "Price lock is inside user budget and hold window is active." },
        { label: "Subscriptions", text: "Recurring payments remain safe to delay." },
        { label: "Grant Payout", text: "Prepared but intentionally not mixed with travel actions." },
        { label: "Current Ask", text: "Travel session moved to the front of the queue." }
      ]
    },
    {
      title: "Approve grant payout session",
      meta: "NOVA proposes a calm, bounded session to execute approved milestone payouts while keeping other sessions visible in the background.",
      wallet: "Grant Wallet",
      action: "3 milestone payouts",
      expiry: "25 minutes",
      policy: "Committee-approved recipients only",
      stage: "Maintaining a balanced session garden",
      floating: [
        { title: "Grant Payout", status: "ready" },
        { title: "Subscriptions", status: "stable" },
        { title: "Travel Hold", status: "expired window" }
      ],
      log: [
        { label: "Grant Payout", text: "Three payout records matched approved milestones." },
        { label: "Subscriptions", text: "No vendor anomalies detected while waiting." },
        { label: "Travel Hold", text: "Booking window closed, no session action taken." },
        { label: "Current Ask", text: "Grant payout session is ready for user approval." }
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
  const floatingNodes = patternNode.querySelectorAll("[data-floating-0], [data-floating-1], [data-floating-2], [data-floating-3]");

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

  function renderFloating(items) {
    if (!floatingNodes.length || !Array.isArray(items)) {
      return;
    }

    floatingNodes.forEach((node, idx) => {
      const titleNode = node.querySelector("strong");
      const statusNode = node.querySelector("small");
      const item = items[idx];

      if (!item) {
        node.style.display = "none";
        return;
      }

      node.style.display = "";
      titleNode.textContent = item.title;
      statusNode.textContent = item.status;
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

    if (request.floating) {
      renderFloating(request.floating);
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

const patternTenData = {
  requests: [
    {
      id: "TREASURY-118",
      title: "Approve payroll settlement session",
      meta: "NOVA has bundled a scheduled payment run into one session with recipient and cap guardrails.",
      wallet: "Operations Wallet",
      expiry: "22 minutes",
      action: "4 salary disbursements",
      policy: "Known recipients only"
    },
    {
      id: "BRIDGE-072",
      title: "Approve bridge settlement session",
      meta: "NOVA wants one short-lived settlement session while other sessions stay visible and draggable around it.",
      wallet: "Bridge Wallet",
      expiry: "9 minutes",
      action: "1 release + 1 gas top-up",
      policy: "Destination wallet bound"
    },
    {
      id: "REWARDS-031",
      title: "Approve rebate operations session",
      meta: "NOVA groups a low-risk reimbursement run into one approval moment while keeping the rest of the board active.",
      wallet: "Rewards Wallet",
      expiry: "13 minutes",
      action: "18 user rebates",
      policy: "Per-user max 50 USDC"
    }
  ],
  sessions: {
    "sess-payroll": {
      id: "PAYROLL-204",
      title: "Payroll settlement session",
      status: "2 actions left",
      meta: "Executing known salary disbursements under a pre-approved payroll session.",
      logs: [
        "09:41 payroll roster synced with HR export",
        "09:43 recipient wallets validated against allowlist",
        "09:44 batch 1/2 complete without deviation",
        "09:46 waiting on final two signatures from policy engine"
      ]
    },
    "sess-rebalance": {
      id: "TREASURY-118",
      title: "Treasury rebalance session",
      status: "approval requested",
      meta: "Temporary treasury session waiting for the next user approval.",
      logs: [
        "10:02 route simulation passed for stablecoin rebalance",
        "10:03 loss cap remained inside treasury rule",
        "10:04 one settlement step queued behind approval",
        "10:05 session is waiting for user consent"
      ]
    },
    "sess-bridge": {
      id: "BRIDGE-072",
      title: "Bridge exit session",
      status: "proof watching",
      meta: "The bridge session is active but blocked on destination finality.",
      logs: [
        "10:10 finality watcher subscribed to checkpoint feed",
        "10:11 destination wallet verified against treasury record",
        "10:12 gas reserve path prepared if release is approved",
        "10:14 still waiting for proof finalization"
      ]
    },
    "sess-rewards": {
      id: "REWARDS-031",
      title: "Rewards rebate session",
      status: "queued",
      meta: "Queued reimbursement session with lower priority than treasury and bridge operations.",
      logs: [
        "10:16 duplicate-wallet scan returned clear",
        "10:18 payout bundle fits per-user reimbursement rule",
        "10:19 queued behind bridge and treasury work",
        "10:20 ready to move into approval slot later"
      ]
    }
  },
  console: [
    "[PAYROLL-204] roster sync complete, 4 recipients verified",
    "[TREASURY-118] approval requested for treasury rebalance session",
    "[BRIDGE-072] proof watcher still active, no finality yet",
    "[REWARDS-031] queued after risk-critical sessions"
  ]
};

function mountPatternTen(patternNode) {
  if (!patternNode) {
    return;
  }

  const requestTitle = patternNode.querySelector("[data-ten-title]");
  const requestMeta = patternNode.querySelector("[data-ten-meta]");
  const requestWallet = patternNode.querySelector("[data-ten-wallet]");
  const requestExpiry = patternNode.querySelector("[data-ten-expiry]");
  const requestAction = patternNode.querySelector("[data-ten-action]");
  const requestPolicy = patternNode.querySelector("[data-ten-policy]");
  const card = patternNode.querySelector("[data-ten-card]");
  const stack = patternNode.querySelector("[data-stack]");
  const emptyState = patternNode.querySelector("[data-empty-state]");
  const stageText = patternNode.querySelector("[data-ten-stage]");
  const consoleNode = patternNode.querySelector("[data-ten-console]");
  const nextButton = patternNode.querySelector("[data-next-ten]");
  const toggleEmpty = patternNode.querySelector("[data-toggle-empty]");
  const approveButton = patternNode.querySelector("[data-ten-approve]");
  const rejectButton = patternNode.querySelector("[data-ten-reject]");
  const modal = patternNode.querySelector("[data-ten-modal]");
  const modalTitle = patternNode.querySelector("[data-ten-modal-title]");
  const modalMeta = patternNode.querySelector("[data-ten-modal-meta]");
  const modalStatus = patternNode.querySelector("[data-ten-modal-status]");
  const modalId = patternNode.querySelector("[data-ten-modal-id]");
  const modalLog = patternNode.querySelector("[data-ten-modal-log]");
  const closeButton = patternNode.querySelector("[data-ten-close]");
  const chips = [...patternNode.querySelectorAll("[data-session-chip]")];

  let requestIndex = 0;
  let emptyMode = false;

  function renderConsole() {
    consoleNode.innerHTML = patternTenData.console
      .map((line) => `<div class="ten-console-line">${line}</div>`)
      .join("");
  }

  function pushConsole(line) {
    patternTenData.console.unshift(line);
    patternTenData.console = patternTenData.console.slice(0, 8);
    renderConsole();
  }

  function renderRequest() {
    const request = patternTenData.requests[requestIndex];
    requestTitle.textContent = request.title;
    requestMeta.textContent = request.meta;
    requestWallet.textContent = request.wallet;
    requestExpiry.textContent = request.expiry;
    requestAction.textContent = request.action;
    requestPolicy.textContent = request.policy;
    stageText.textContent = emptyMode
      ? "Supervising active sessions without pending approval"
      : `Supervising wallet sessions and preparing ${request.id}`;
    toggleEmpty.textContent = `No-request mode: ${emptyMode ? "On" : "Off"}`;
    stack.hidden = emptyMode;
    emptyState.hidden = !emptyMode;
  }

  function cycleRequest() {
    requestIndex = (requestIndex + 1) % patternTenData.requests.length;
    renderRequest();
  }

  function markRequest(state) {
    const request = patternTenData.requests[requestIndex];
    card.classList.remove("approved", "rejected");
    void card.offsetWidth;
    card.classList.add(state);
    pushConsole(
      `[${request.id}] ${state === "approved" ? "approved" : "rejected"} by user, next queue item promoted`
    );
    window.setTimeout(() => {
      card.classList.remove("approved", "rejected");
      cycleRequest();
    }, 700);
  }

  function showModal(sessionKey) {
    const session = patternTenData.sessions[sessionKey];
    modalTitle.textContent = session.title;
    modalMeta.textContent = session.meta;
    modalStatus.textContent = session.status;
    modalId.textContent = session.id;
    modalLog.innerHTML = session.logs
      .map((line) => `<div class="ten-modal-line">${line}</div>`)
      .join("");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function makeChipDraggable(chip) {
    const stage = patternNode.querySelector("[data-session-stage]");
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;

    chip.addEventListener("pointerdown", (event) => {
      dragging = true;
      moved = false;
      chip.setPointerCapture(event.pointerId);
      chip.classList.add("dragging");
      startX = event.clientX - chip.offsetLeft;
      startY = event.clientY - chip.offsetTop;
    });

    chip.addEventListener("pointermove", (event) => {
      if (!dragging || window.innerWidth <= 720) {
        return;
      }

      const rect = stage.getBoundingClientRect();
      const x = Math.min(
        Math.max(0, event.clientX - rect.left - startX),
        rect.width - chip.offsetWidth
      );
      const y = Math.min(
        Math.max(0, event.clientY - rect.top - startY),
        rect.height - chip.offsetHeight
      );

      moved = true;
      chip.style.left = `${x}px`;
      chip.style.top = `${y}px`;
      chip.style.right = "auto";
      chip.style.bottom = "auto";
    });

    chip.addEventListener("pointerup", (event) => {
      dragging = false;
      chip.releasePointerCapture(event.pointerId);
      chip.classList.remove("dragging");
    });

    chip.addEventListener("click", () => {
      if (!moved) {
        showModal(chip.dataset.sessionChip);
      }
    });
  }

  nextButton.addEventListener("click", cycleRequest);
  toggleEmpty.addEventListener("click", () => {
    emptyMode = !emptyMode;
    renderRequest();
    pushConsole(`[SYSTEM] ${emptyMode ? "no approval pending mode enabled" : "approval queue restored"}`);
  });
  approveButton.addEventListener("click", () => markRequest("approved"));
  rejectButton.addEventListener("click", () => markRequest("rejected"));
  closeButton.addEventListener("click", hideModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      hideModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      hideModal();
    }
  });

  chips.forEach(makeChipDraggable);
  renderConsole();
  renderRequest();
}

mountPatternTen(document.querySelector("[data-proposal-pattern='10']"));
