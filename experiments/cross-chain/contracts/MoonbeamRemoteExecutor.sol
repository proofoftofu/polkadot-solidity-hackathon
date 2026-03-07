// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MoonbeamRemoteExecutor {
    error OnlyRouter();
    error UntrustedHubSender();

    address public immutable router;
    address public immutable trustedHubSender;

    uint256 public lastValue;
    bytes32 public lastMemo;
    address public lastHubSender;
    uint256 public executionCount;

    event RemoteValueUpdated(address indexed hubSender, uint256 value, bytes32 memo);

    constructor(address routerAddress, address trustedHubSenderAddress) {
        router = routerAddress;
        trustedHubSender = trustedHubSenderAddress;
    }

    function executeFromHub(
        address hubSender,
        uint256 newValue,
        bytes32 memo
    ) external {
        if (msg.sender != router) {
            revert OnlyRouter();
        }
        if (hubSender != trustedHubSender) {
            revert UntrustedHubSender();
        }

        lastHubSender = hubSender;
        lastValue = newValue;
        lastMemo = memo;
        executionCount += 1;

        emit RemoteValueUpdated(hubSender, newValue, memo);
    }
}
