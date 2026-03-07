// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IXcm.sol";

contract CrossChainDispatcher {
    error NotOwner();
    error EmptyEncodedMessage();
    error InvalidTeleportConfig();

    struct TeleportConfig {
        uint32 destinationParaId;
        bytes32 beneficiaryAccountId32;
        uint128 amount;
        uint128 localFee;
        uint128 remoteFee;
    }

    address public immutable owner;
    IXcm public immutable xcm;
    event RawXcmDispatched(bytes32 indexed requestId, bytes destination, bytes message);
    event RawXcmExecuted(bytes32 indexed requestId, bytes message, uint64 refTime, uint64 proofSize);
    event TeleportExecuted(
        bytes32 indexed requestId,
        uint32 indexed destinationParaId,
        bytes32 indexed beneficiaryAccountId32,
        uint128 amount,
        uint128 localFee,
        uint128 remoteFee
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

    function buildTeleportMessage(TeleportConfig calldata config) public pure returns (bytes memory) {
        _validateTeleportConfig(config);

        return bytes.concat(
            hex"050c0004010000",
            _encodeCompact(config.amount),
            hex"30010000",
            _encodeCompact(config.localFee),
            hex"31010100",
            _encodeCompact(config.destinationParaId),
            hex"01000004010000",
            _encodeCompact(config.remoteFee),
            hex"000400010204040d01020400010100",
            abi.encodePacked(config.beneficiaryAccountId32)
        );
    }

    function estimateTeleportWeight(TeleportConfig calldata config) external view returns (IXcm.Weight memory) {
        return xcm.weighMessage(buildTeleportMessage(config));
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

    function executeTeleport(bytes32 requestId, TeleportConfig calldata config) external onlyOwner {
        bytes memory encodedMessage = buildTeleportMessage(config);
        IXcm.Weight memory weight = xcm.weighMessage(encodedMessage);

        xcm.execute(encodedMessage, weight);
        emit RawXcmExecuted(requestId, encodedMessage, weight.refTime, weight.proofSize);
        emit TeleportExecuted(
            requestId,
            config.destinationParaId,
            config.beneficiaryAccountId32,
            config.amount,
            config.localFee,
            config.remoteFee
        );
    }

    function _validateTeleportConfig(TeleportConfig calldata config) private pure {
        if (
            config.destinationParaId == 0 || config.beneficiaryAccountId32 == bytes32(0) || config.amount == 0
                || config.localFee == 0 || config.remoteFee == 0 || config.amount <= config.localFee + config.remoteFee
        ) {
            revert InvalidTeleportConfig();
        }
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
}
