// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract CrossChainReceiver {
    error OnlyRelayer();
    error UntrustedHubDispatcher();
    error ReplayDetected();
    error TargetCallFailed(bytes reason);

    address public immutable trustedRelayer;
    address public immutable trustedHubDispatcher;

    mapping(bytes32 requestId => bool executed) public executedRequests;

    event CrossChainCallExecuted(
        address indexed dispatcher,
        address indexed target,
        bytes32 indexed requestId,
        uint256 value
    );

    constructor(address trustedRelayer_, address trustedHubDispatcher_) {
        trustedRelayer = trustedRelayer_;
        trustedHubDispatcher = trustedHubDispatcher_;
    }

    function receiveCrossChainCall(
        address hubDispatcher,
        address target,
        uint256 value,
        bytes calldata callData,
        bytes32 requestId
    ) external returns (bytes memory result) {
        if (msg.sender != trustedRelayer) {
            revert OnlyRelayer();
        }
        if (hubDispatcher != trustedHubDispatcher) {
            revert UntrustedHubDispatcher();
        }
        if (executedRequests[requestId]) {
            revert ReplayDetected();
        }

        executedRequests[requestId] = true;
        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        if (!success) {
            revert TargetCallFailed(returnData);
        }

        emit CrossChainCallExecuted(hubDispatcher, target, requestId, value);
        return returnData;
    }
}
