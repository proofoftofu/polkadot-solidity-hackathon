import { createPublicClient, createWalletClient, getContract, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
console.log("address: ", account.address);

const chain = {
  id: 420420417,
  name: "Polkadot Hub Testnet",
  nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://services.polkadothub-rpc.com/testnet"]
    }
  }
};

const publicClient = createPublicClient({
  chain,
  transport: http("https://services.polkadothub-rpc.com/testnet")
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http("https://services.polkadothub-rpc.com/testnet")
});

const xcm = getContract({
  address: "0x00000000000000000000000000000000000a0000",
  abi: [
    {
      type: "function",
      name: "weighMessage",
      stateMutability: "view",
      inputs: [{ name: "message", type: "bytes" }],
      outputs: [
        {
          name: "weight",
          type: "tuple",
          components: [
            { name: "refTime", type: "uint64" },
            { name: "proofSize", type: "uint64" }
          ]
        }
      ]
    },
    {
      type: "function",
      name: "execute",
      stateMutability: "nonpayable",
      inputs: [
        { name: "message", type: "bytes" },
        {
          name: "weight",
          type: "tuple",
          components: [
            { name: "refTime", type: "uint64" },
            { name: "proofSize", type: "uint64" }
          ]
        }
      ],
      outputs: []
    }
  ],
  client: {
    public: publicClient,
    wallet: walletClient
  }
});

const message =
  "0x050c00040100000700e40b54023001000002286bee31010100a90f0100000401000002286bee000400010204040d010204000101008eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";

async function main() {
  const weight = await xcm.read.weighMessage([message]);
  console.log("weight", weight);

  const hash = await xcm.write.execute([message, weight], {
    account,
  });
  console.log("tx hash", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("receipt", receipt.transactionHash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
