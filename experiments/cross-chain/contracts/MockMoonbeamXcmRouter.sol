// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockMoonbeamXcmRouter {
    error InvalidDestination();
    error ForwardFailed(bytes reason);

    bytes32 public immutable expectedDestinationHash;

    event XcmDelivered(
        address indexed hubSender,
        address indexed receiver,
        bytes destination,
        bytes payload
    );

    constructor(bytes memory expectedDestination) {
        expectedDestinationHash = keccak256(expectedDestination);
    }

    function routeMessage(
        address hubSender,
        bytes calldata destination,
        bytes calldata message
    ) external {
        if (keccak256(destination) != expectedDestinationHash) {
            revert InvalidDestination();
        }

        (address receiver, bytes memory callData) = abi.decode(message, (address, bytes));
        (bool ok, bytes memory reason) = receiver.call(callData);
        if (!ok) {
            revert ForwardFailed(reason);
        }

        emit XcmDelivered(hubSender, receiver, destination, message);
    }
}
