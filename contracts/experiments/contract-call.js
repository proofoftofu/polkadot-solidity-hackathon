import { createPublicClient, createWalletClient, getContract, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
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
  "0x050c000401000003008c86471301000003008c8647000d010101000000010100368e8759910dab756d344995f1d3c79374ca8f70066d3a709e48029f6bf0ee7e";

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
