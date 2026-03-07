// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IXcm.sol";
import "./MockMoonbeamXcmRouter.sol";

contract MockXcmPrecompile is IXcm {
    MockMoonbeamXcmRouter public immutable router;

    event XcmSent(address indexed caller, bytes destination, bytes message);
    event XcmExecuted(bytes message, Weight weight);

    constructor(address routerAddress) {
        router = MockMoonbeamXcmRouter(routerAddress);
    }

    function execute(bytes calldata message, Weight calldata weight) external {
        emit XcmExecuted(message, weight);
    }

    function send(bytes calldata destination, bytes calldata message) external {
        emit XcmSent(msg.sender, destination, message);
        router.routeMessage(msg.sender, destination, message);
    }

    function weighMessage(bytes calldata message) external pure returns (Weight memory weight) {
        uint64 len = uint64(message.length);
        return Weight({refTime: 100_000 + (len * 10_000), proofSize: len});
    }
}
