// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IXcm.sol";

contract CrossChainDispatcher {
    uint8 public constant ENDPOINT_KIND_EXECUTE = 0;
    uint8 public constant ENDPOINT_KIND_SEND = 1;

    uint8 public constant INSTRUCTION_KIND_WITHDRAW_ASSET = 0;
    uint8 public constant INSTRUCTION_KIND_BUY_EXECUTION = 1;
    uint8 public constant INSTRUCTION_KIND_PAY_FEES = 2;
    uint8 public constant INSTRUCTION_KIND_INITIATE_TRANSFER = 3;
    uint8 public constant INSTRUCTION_KIND_DEPOSIT_ASSET = 4;

    bytes32 public constant PAS_NATIVE_ASSET_ID = keccak256("polkadot-hub/pas-native");

    error NotOwner();
    error EmptyEncodedMessage();
    error InvalidEndpoint();
    error UnsupportedInstructionSequence();
    error InvalidInstructionCount();
    error InvalidInstructionAsset();
    error InvalidInstructionAmount();
    error InvalidInstructionTarget();

    struct XcmInstruction {
        uint8 kind;
        bytes32 assetId;
        uint128 amount;
        uint32 paraId;
        bytes32 accountId32;
    }

    struct XcmProgram {
        uint8 endpointKind;
        uint32 endpointParaId;
        XcmInstruction[] instructions;
    }

    struct TransferProgramSummary {
        bytes32 assetId;
        uint128 withdrawAmount;
        uint128 localFee;
        uint128 remoteFee;
        uint32 destinationParaId;
        bytes32 beneficiaryAccountId32;
    }

    address public immutable owner;
    IXcm public immutable xcm;

    event RawXcmDispatched(bytes32 indexed requestId, bytes destination, bytes message);
    event RawXcmExecuted(bytes32 indexed requestId, bytes message, uint64 refTime, uint64 proofSize);
    event ProgramExecuted(
        bytes32 indexed requestId,
        uint8 indexed endpointKind,
        bytes32 indexed assetId,
        uint128 withdrawAmount,
        uint32 destinationParaId,
        bytes32 beneficiaryAccountId32
    );

    receive() external payable {}

    constructor(address owner_, address xcmPrecompileAddress) {
        owner = owner_;
        xcm = IXcm(xcmPrecompileAddress);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    function estimateEncodedMessageWeight(bytes calldata message) external view returns (IXcm.Weight memory) {
        if (message.length == 0) {
            revert EmptyEncodedMessage();
        }
        return xcm.weighMessage(message);
    }

    function buildProgram(XcmProgram calldata program) public pure returns (bytes memory) {
        TransferProgramSummary memory summary = _summarizeTransferProgram(program);

        return bytes.concat(
            hex"050c0004010000",
            _encodeCompact(summary.withdrawAmount),
            hex"30010000",
            _encodeCompact(summary.localFee),
            hex"31010100",
            _encodeCompact(summary.destinationParaId),
            hex"01000004010000",
            _encodeCompact(summary.remoteFee),
            hex"000400010204040d01020400010100",
            abi.encodePacked(summary.beneficiaryAccountId32)
        );
    }

    function estimateProgramWeight(XcmProgram calldata program) external view returns (IXcm.Weight memory) {
        return xcm.weighMessage(buildProgram(program));
    }

    function dispatchEncodedMessage(bytes32 requestId, bytes calldata destination, bytes calldata encodedMessage)
        external
        onlyOwner
    {
        if (encodedMessage.length == 0) {
            revert EmptyEncodedMessage();
        }

        xcm.send(destination, encodedMessage);
        emit RawXcmDispatched(requestId, destination, encodedMessage);
    }

    function executeEncodedMessage(bytes32 requestId, bytes calldata encodedMessage, IXcm.Weight calldata weight)
        external
        onlyOwner
    {
        if (encodedMessage.length == 0) {
            revert EmptyEncodedMessage();
        }

        xcm.execute(encodedMessage, weight);
        emit RawXcmExecuted(requestId, encodedMessage, weight.refTime, weight.proofSize);
    }

    function executeProgram(bytes32 requestId, XcmProgram calldata program) external onlyOwner {
        if (program.endpointKind != ENDPOINT_KIND_EXECUTE) {
            revert InvalidEndpoint();
        }

        TransferProgramSummary memory summary = _summarizeTransferProgram(program);
        bytes memory encodedMessage = buildProgram(program);
        IXcm.Weight memory weight = xcm.weighMessage(encodedMessage);

        xcm.execute(encodedMessage, weight);
        emit RawXcmExecuted(requestId, encodedMessage, weight.refTime, weight.proofSize);
        emit ProgramExecuted(
            requestId,
            program.endpointKind,
            summary.assetId,
            summary.withdrawAmount,
            summary.destinationParaId,
            summary.beneficiaryAccountId32
        );
    }

    function dispatchProgram(bytes32 requestId, XcmProgram calldata program) external onlyOwner {
        if (program.endpointKind != ENDPOINT_KIND_SEND) {
            revert InvalidEndpoint();
        }
        if (program.endpointParaId == 0) {
            revert InvalidInstructionTarget();
        }

        TransferProgramSummary memory summary = _summarizeTransferProgram(program);
        bytes memory encodedMessage = buildProgram(program);
        bytes memory destination = _encodeParachainDestination(program.endpointParaId);

        xcm.send(destination, encodedMessage);
        emit RawXcmDispatched(requestId, destination, encodedMessage);
        emit ProgramExecuted(
            requestId,
            program.endpointKind,
            summary.assetId,
            summary.withdrawAmount,
            summary.destinationParaId,
            summary.beneficiaryAccountId32
        );
    }

    function summarizeProgram(XcmProgram calldata program) external pure returns (TransferProgramSummary memory) {
        return _summarizeTransferProgram(program);
    }

    function _summarizeTransferProgram(XcmProgram calldata program)
        private
        pure
        returns (TransferProgramSummary memory summary)
    {
        if (program.instructions.length != 4) {
            revert InvalidInstructionCount();
        }

        XcmInstruction calldata withdrawInstruction = program.instructions[0];
        XcmInstruction calldata payFeesInstruction = program.instructions[1];
        XcmInstruction calldata transferInstruction = program.instructions[2];
        XcmInstruction calldata depositInstruction = program.instructions[3];

        if (
            withdrawInstruction.kind != INSTRUCTION_KIND_WITHDRAW_ASSET
                || payFeesInstruction.kind != INSTRUCTION_KIND_PAY_FEES
                || transferInstruction.kind != INSTRUCTION_KIND_INITIATE_TRANSFER
                || depositInstruction.kind != INSTRUCTION_KIND_DEPOSIT_ASSET
        ) {
            revert UnsupportedInstructionSequence();
        }
        if (
            withdrawInstruction.assetId != PAS_NATIVE_ASSET_ID || payFeesInstruction.assetId != PAS_NATIVE_ASSET_ID
                || transferInstruction.assetId != PAS_NATIVE_ASSET_ID
        ) {
            revert InvalidInstructionAsset();
        }
        if (
            withdrawInstruction.amount == 0 || payFeesInstruction.amount == 0 || transferInstruction.amount == 0
                || withdrawInstruction.amount <= payFeesInstruction.amount + transferInstruction.amount
        ) {
            revert InvalidInstructionAmount();
        }
        if (transferInstruction.paraId == 0 || depositInstruction.accountId32 == bytes32(0)) {
            revert InvalidInstructionTarget();
        }
        if (
            withdrawInstruction.paraId != 0 || withdrawInstruction.accountId32 != bytes32(0)
                || payFeesInstruction.paraId != 0 || payFeesInstruction.accountId32 != bytes32(0)
                || depositInstruction.assetId != bytes32(0) || depositInstruction.amount != 0
                || depositInstruction.paraId != 0
        ) {
            revert UnsupportedInstructionSequence();
        }

        summary = TransferProgramSummary({
            assetId: withdrawInstruction.assetId,
            withdrawAmount: withdrawInstruction.amount,
            localFee: payFeesInstruction.amount,
            remoteFee: transferInstruction.amount,
            destinationParaId: transferInstruction.paraId,
            beneficiaryAccountId32: depositInstruction.accountId32
        });
    }

    function _encodeCompact(uint256 value) private pure returns (bytes memory encoded) {
        if (value < 1 << 6) {
            encoded = abi.encodePacked(bytes1(uint8(value << 2)));
        } else if (value < 1 << 14) {
            uint16 shifted = uint16((value << 2) | 1);
            encoded = abi.encodePacked(bytes1(uint8(shifted)), bytes1(uint8(shifted >> 8)));
        } else if (value < 1 << 30) {
            uint32 shifted = uint32((value << 2) | 2);
            encoded = abi.encodePacked(
                bytes1(uint8(shifted)),
                bytes1(uint8(shifted >> 8)),
                bytes1(uint8(shifted >> 16)),
                bytes1(uint8(shifted >> 24))
            );
        } else {
            uint256 temp = value;
            uint8 length = 0;
            while (temp != 0) {
                length += 1;
                temp >>= 8;
            }

            encoded = new bytes(length + 1);
            encoded[0] = bytes1(uint8(((length - 4) << 2) | 3));
            for (uint8 i = 0; i < length; i++) {
                encoded[i + 1] = bytes1(uint8(value >> (8 * i)));
            }
        }
    }

    function _encodeParachainDestination(uint32 paraId) private pure returns (bytes memory) {
        return bytes.concat(hex"050100", _encodeCompact(paraId));
    }
}
