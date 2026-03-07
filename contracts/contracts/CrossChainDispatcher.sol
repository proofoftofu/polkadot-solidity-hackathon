// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IXcm.sol";

contract CrossChainDispatcher {
    error NotOwner();
    error UnsupportedDestination();
    error UnsupportedReceiver();
    error MessageVersionUnset();
    error EmptyEncodedMessage();

    struct RemoteCall {
        uint256 destinationChainId;
        address receiver;
        address target;
        uint256 value;
        bytes callData;
        bytes32 requestId;
    }

    address public immutable owner;
    IXcm public immutable xcm;
    bytes public destination;
    bytes public messagePrefix;
    uint256 public immutable supportedDestinationChainId;

    mapping(address receiver => bool allowed) public allowedReceivers;

    event ReceiverAllowed(address indexed receiver, bool allowed);
    event DestinationUpdated(bytes destination);
    event MessagePrefixUpdated(bytes messagePrefix);
    event CrossChainDispatchQueued(
        uint256 indexed destinationChainId,
        address indexed receiver,
        address indexed target,
        bytes32 requestId,
        bytes message
    );
    event RawXcmDispatched(address indexed target, bytes32 indexed requestId, bytes destination, bytes message);
    event RawXcmExecuted(bytes32 indexed requestId, bytes message, uint64 refTime, uint64 proofSize);

    receive() external payable {}

    constructor(address owner_, address xcmPrecompileAddress, uint256 destinationChainId_, bytes memory destination_) {
        owner = owner_;
        xcm = IXcm(xcmPrecompileAddress);
        supportedDestinationChainId = destinationChainId_;
        destination = destination_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    function setDestination(bytes calldata destination_) external onlyOwner {
        destination = destination_;
        emit DestinationUpdated(destination_);
    }

    function setMessagePrefix(bytes calldata messagePrefix_) external onlyOwner {
        messagePrefix = messagePrefix_;
        emit MessagePrefixUpdated(messagePrefix_);
    }

    function setAllowedReceiver(address receiver, bool allowed) external onlyOwner {
        allowedReceivers[receiver] = allowed;
        emit ReceiverAllowed(receiver, allowed);
    }

    function estimateDispatchWeight(RemoteCall calldata remoteCall) external view returns (IXcm.Weight memory) {
        return xcm.weighMessage(_buildMessage(remoteCall));
    }

    function estimateEncodedMessageWeight(bytes calldata message) external view returns (IXcm.Weight memory) {
        if (message.length == 0) {
            revert EmptyEncodedMessage();
        }
        return xcm.weighMessage(message);
    }

    function dispatchRemoteCall(RemoteCall calldata remoteCall) external onlyOwner {
        if (remoteCall.destinationChainId != supportedDestinationChainId) {
            revert UnsupportedDestination();
        }
        if (!allowedReceivers[remoteCall.receiver]) {
            revert UnsupportedReceiver();
        }
        bytes memory message = _buildMessage(remoteCall);
        xcm.send(destination, message);
        emit CrossChainDispatchQueued(
            remoteCall.destinationChainId, remoteCall.receiver, remoteCall.target, remoteCall.requestId, message
        );
    }

    function dispatchEncodedMessage(address target, bytes32 requestId, bytes calldata encodedMessage) external onlyOwner {
        if (!allowedReceivers[target]) {
            revert UnsupportedReceiver();
        }
        if (encodedMessage.length == 0) {
            revert EmptyEncodedMessage();
        }

        xcm.send(destination, encodedMessage);
        emit RawXcmDispatched(target, requestId, destination, encodedMessage);
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

    function _buildMessage(RemoteCall calldata remoteCall) internal view returns (bytes memory) {
        if (messagePrefix.length == 0) {
            revert MessageVersionUnset();
        }
        return abi.encode(
            messagePrefix,
            remoteCall.receiver,
            abi.encodeWithSignature(
                "receiveCrossChainCall(address,address,uint256,bytes,bytes32)",
                address(this),
                remoteCall.target,
                remoteCall.value,
                remoteCall.callData,
                remoteCall.requestId
            )
        );
    }
}
