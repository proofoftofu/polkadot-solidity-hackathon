export const appState = {
  product: {
    name: "Secure Agent Wallet Hub",
    role: "A wallet dashboard for managing secure session keys that AI agents can use only after approval."
  },
  wallet: {
    address: "0x4B7B...71A9",
    owner: "mina@web3auth",
    homeChain: "Polkadot Hub",
    status: "Wallet online and ready",
    recentProcess: "Monitoring session-key state"
  },
  sessions: [
    {
      id: "sess_ai_01",
      agent: "Calendar Agent",
      status: "active",
      summary: "Can read and update one scheduled payment reminder only.",
      userFriendly:
        "This session key is already active and limited to one reminder-related helper function.",
      approvalChain: "Polkadot Hub",
      targetChain: "Polkadot Hub",
      contract: "0xB3d1...91aa",
      selector: "0x70a08231",
      scope: "One reminder helper call",
      expiry: "6 hours",
      valueCap: "0 DEV",
      sponsorship: "Paymaster-backed"
    },
    {
      id: "sess_ai_02",
      agent: "Research Agent",
      status: "pending",
      summary: "Needs one session key to run a guided treasury helper action.",
      userFriendly:
        "This lets the AI agent perform one limited helper action after you approve the session key.",
      approvalChain: "Polkadot Hub",
      targetChain: "Moonbeam",
      contract: "0xA0b8...4eb0",
      selector: "0xa9059cbb",
      scope: "One sponsored helper call for the requested task",
      expiry: "2 hours",
      valueCap: "0.02 DEV",
      sponsorship: "Paymaster-backed"
    }
  ],
  sessionTemplates: [
    {
      id: "sess_ai_03",
      agent: "Ops Agent",
      status: "pending",
      summary: "Prepared a fresh request for one limited monitoring helper call.",
      userFriendly:
        "This new request is limited to a single monitoring helper action after approval.",
      approvalChain: "Polkadot Hub",
      targetChain: "Polkadot Hub",
      contract: "0xE27f...88ab",
      selector: "0x23b872dd",
      scope: "One monitoring helper call",
      expiry: "3 hours",
      valueCap: "0 DEV",
      sponsorship: "Paymaster-backed"
    },
    {
      id: "sess_ai_04",
      agent: "Travel Agent",
      status: "pending",
      summary: "Needs a short-lived session key for one itinerary deposit helper action.",
      userFriendly:
        "This would let the AI assistant complete one travel-related helper action if you approve it.",
      approvalChain: "Polkadot Hub",
      targetChain: "Moonbeam",
      contract: "0xD4c9...1af2",
      selector: "0x095ea7b3",
      scope: "One sponsored itinerary helper call",
      expiry: "90 minutes",
      valueCap: "0.01 DEV",
      sponsorship: "Paymaster-backed"
    }
  ],
  sessionHistory: {
    sess_ai_01: [
      {
        id: "sess_ai_01-opened",
        kind: "info",
        label: "Loaded",
        time: "09:41",
        title: "Session loaded into wallet",
        body: "The wallet restored this active session key and confirmed the owner signer."
      },
      {
        id: "sess_ai_01-backend",
        kind: "success",
        label: "Used",
        time: "09:48",
        title: "Backend used the session key",
        body: "The AI agent used the approved reminder helper permission within the allowed scope."
      }
    ],
    sess_ai_02: [
      {
        id: "sess_ai_02-created",
        kind: "warning",
        label: "Pending",
        time: "10:02",
        title: "Session request created",
        body: "The backend requested a new scoped session key and is waiting for your approval."
      }
    ]
  },
  activity: {
    afterApproval: (session) => ({
      id: `${session.id}-approved`,
      kind: "success",
      label: "Approved",
      time: "Now",
      title: "Session key activated",
      body: `The wallet installed a scoped session for ${session.agent}. The backend can now use only the approved contract, selector, expiry, and value cap.`
    }),
    afterRevoke: (session) => ({
      id: `${session.id}-revoked`,
      kind: "warning",
      label: "Revoked",
      time: "Now",
      title: "Session key removed",
      body: `The ${session.agent} session key was revoked and removed from the active dashboard list.`
    }),
    afterNewSession: (session) => ({
      id: `${session.id}-created`,
      kind: "warning",
      label: "Queued",
      time: "Now",
      title: "New session key request created",
      body: `The backend opened a new request for ${session.agent}. It is now in the dashboard list and waiting for approval.`
    })
  }
};
