// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IXcm.sol";

contract CrossChainDispatcher {
    error NotOwner();
    error EmptyEncodedMessage();

    address public immutable owner;
    IXcm public immutable xcm;
    event RawXcmDispatched(bytes32 indexed requestId, bytes destination, bytes message);
    event RawXcmExecuted(bytes32 indexed requestId, bytes message, uint64 refTime, uint64 proofSize);

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
}
