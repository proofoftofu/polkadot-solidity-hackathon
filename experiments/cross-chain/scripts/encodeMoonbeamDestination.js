import { encodeAbiParameters, parseAbiParameters } from "viem";

const paraId = Number.parseInt(process.env.MOONBEAM_PARA_ID ?? "2004", 10);
const accountKey20 = process.env.MOONBEAM_ACCOUNT_KEY20 ?? "0x1111111111111111111111111111111111111111";
const parents = Number.parseInt(process.env.MOONBEAM_PARENTS ?? "1", 10);

const encoded = encodeAbiParameters(
  parseAbiParameters("uint8 parents, uint32 paraId, bytes20 accountKey20"),
  [parents, paraId, accountKey20]
);

console.log(encoded);
