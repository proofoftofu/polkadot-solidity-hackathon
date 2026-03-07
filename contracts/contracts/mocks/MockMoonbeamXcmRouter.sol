// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockMoonbeamXcmRouter {
    error InvalidDestination();

    bytes32 public immutable expectedDestinationHash;

    event XcmDelivered(address indexed hubSender, bytes destination, bytes payload);

    constructor(bytes memory expectedDestination) {
        expectedDestinationHash = keccak256(expectedDestination);
    }

    function routeMessage(address hubSender, bytes calldata destination, bytes calldata message) external {
        if (keccak256(destination) != expectedDestinationHash) {
            revert InvalidDestination();
        }
        emit XcmDelivered(hubSender, destination, message);
    }
}
