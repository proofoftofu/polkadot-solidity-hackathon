import { keccak256, stringToHex } from "viem";

export const APP_AGENT_ID = "agent.execute";
export const POLKADOT_HUB_CHAIN_ID = 420420417n;
export const DEFAULT_OWNER_ADDRESS =
  process.env.NEXT_PUBLIC_DEFAULT_OWNER_ADDRESS ?? "0x1234567890123456789012345678901234567890";
export const DEFAULT_SESSION_DURATION_SECONDS = Number.parseInt(process.env.APP_SESSION_DURATION_SECONDS ?? "3600", 10);
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
export const BASE_MODE = ZERO_BYTES32;

export const OPERATION_KIND_XCM_PROGRAM = 1;
export const ENDPOINT_KIND_EXECUTE = 0;
export const XCM_INSTRUCTION_WITHDRAW_ASSET = 0;
export const XCM_INSTRUCTION_BUY_EXECUTION = 1;
export const XCM_INSTRUCTION_PAY_FEES = 2;
export const XCM_INSTRUCTION_INITIATE_TRANSFER = 3;
export const XCM_INSTRUCTION_DEPOSIT_ASSET = 4;
export const EXECUTE_PROGRAM_SELECTOR = "0x9d998c8f";
export const PAS_ASSET_ID = keccak256(stringToHex("polkadot-hub/pas-native"));

export const SUPPORTED_ROUTES = {
  "people-paseo": {
    chainId: "people-paseo",
    label: "People Chain Paseo",
    paraId: 1004,
    sourceChain: "polkadot-hub-testnet",
    sourceChainLabel: "Polkadot Hub Testnet",
    allowedEndpointKinds: [ENDPOINT_KIND_EXECUTE],
    allowedInstructionKinds: [
      XCM_INSTRUCTION_WITHDRAW_ASSET,
      XCM_INSTRUCTION_PAY_FEES,
      XCM_INSTRUCTION_INITIATE_TRANSFER,
      XCM_INSTRUCTION_DEPOSIT_ASSET
    ]
  }
};
