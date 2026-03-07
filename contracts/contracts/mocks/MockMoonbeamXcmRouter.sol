// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockMoonbeamXcmRouter {
    error InvalidDestination();
    error InvalidPrefix();
    error ForwardFailed(bytes reason);

    bytes32 public immutable expectedDestinationHash;
    bytes32 public immutable expectedPrefixHash;

    event XcmDelivered(address indexed hubSender, address indexed receiver, bytes destination, bytes payload);

    constructor(bytes memory expectedDestination, bytes memory expectedPrefix) {
        expectedDestinationHash = keccak256(expectedDestination);
        expectedPrefixHash = keccak256(expectedPrefix);
    }

    function routeMessage(address hubSender, bytes calldata destination, bytes calldata message) external {
        if (keccak256(destination) != expectedDestinationHash) {
            revert InvalidDestination();
        }

        (bytes memory prefix, address receiver, bytes memory callData) = abi.decode(message, (bytes, address, bytes));
        if (keccak256(prefix) != expectedPrefixHash) {
            revert InvalidPrefix();
        }

        (bool ok, bytes memory reason) = receiver.call(callData);
        if (!ok) {
            revert ForwardFailed(reason);
        }

        emit XcmDelivered(hubSender, receiver, destination, message);
    }
}
