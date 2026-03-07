// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IXcm.sol";

contract PolkadotHubXcmSender {
    IXcm public immutable xcm;
    bytes public moonbeamDestination;

    event MoonbeamDispatchQueued(
        address indexed remoteReceiver,
        uint256 value,
        bytes32 memo,
        bytes destination,
        bytes message
    );

    constructor(address xcmPrecompileAddress, bytes memory moonbeamDestinationBytes) {
        xcm = IXcm(xcmPrecompileAddress);
        moonbeamDestination = moonbeamDestinationBytes;
    }

    function estimateDispatchWeight(
        address remoteReceiver,
        uint256 value,
        bytes32 memo
    ) external view returns (IXcm.Weight memory) {
        return xcm.weighMessage(_buildRemoteEnvelope(remoteReceiver, value, memo));
    }

    function dispatchSetValue(
        address remoteReceiver,
        uint256 value,
        bytes32 memo
    ) external {
        bytes memory message = _buildRemoteEnvelope(remoteReceiver, value, memo);
        xcm.send(moonbeamDestination, message);
        emit MoonbeamDispatchQueued(remoteReceiver, value, memo, moonbeamDestination, message);
    }

    function _buildRemoteEnvelope(
        address remoteReceiver,
        uint256 value,
        bytes32 memo
    ) internal view returns (bytes memory) {
        bytes memory callData = abi.encodeWithSignature(
            "executeFromHub(address,uint256,bytes32)",
            address(this),
            value,
            memo
        );

        return abi.encode(remoteReceiver, callData);
    }
}
