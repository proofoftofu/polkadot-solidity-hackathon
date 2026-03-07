import { blake2AsU8a } from "@polkadot/util-crypto";
import { hexToU8a, stringToU8a, u8aConcat, u8aToHex } from "@polkadot/util";
import { ApiPromise, WsProvider } from "@polkadot/api";

function evmToSubstrateAccount(address) {
  return u8aToHex(
    blake2AsU8a(u8aConcat(stringToU8a("evm:"), hexToU8a(address)), 256)
  );
}

async function main() {
  const api = await ApiPromise.create({
    provider: new WsProvider("wss://asset-hub-paseo-rpc.n.dwellir.com")
  });

  const eoa20 = "0x0bc298a4a0a205875f5ae3b19506669c55b38d01";
  const derived32 = evmToSubstrateAccount(eoa20);

  const message =
    "0x050c00040100000700e40b54023001000002286bee31010100a90f0100000401000002286bee000400010204040d010204000101008eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";

  const origins = {
    accountKey20: {
      V5: {
        parents: 0,
        interior: {
          X1: [
            {
              AccountKey20: {
                network: null,
                key: eoa20
              }
            }
          ]
        }
      }
    },
    accountId32Derived: {
      V5: {
        parents: 0,
        interior: {
          X1: [
            {
              AccountId32: {
                network: null,
                id: derived32
              }
            }
          ]
        }
      }
    }
  };

  console.log("EOA:", eoa20);
  console.log("Derived AccountId32:", derived32);

  for (const [label, origin] of Object.entries(origins)) {
    const result = await api.call.dryRunApi.dryRunXcm(origin, message);
    console.log(label, JSON.stringify(result.toJSON(), null, 2));
  }

  await api.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
