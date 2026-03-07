// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/WalletTypes.sol";

interface I4337Account {
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        returns (uint256 validationData);

    function executeUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external;
}

interface I4337Paymaster {
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        returns (bytes memory context, uint256 validationData);

    function postOp(bytes calldata context, bool success) external;
}

interface IAccountFactory {
    function createWallet(address owner) external returns (address wallet);
}

contract MockEntryPoint {
    error SenderDeploymentFailed();
    error SenderAddressMismatch();
    error PaymasterValidationFailed();
    error AccountExecutionFailed(bytes reason);

    event UserOperationHandled(address indexed sender, bytes32 indexed userOpHash, address indexed paymaster);

    function handleOps(PackedUserOperation[] calldata ops) external {
        for (uint256 i = 0; i < ops.length; i++) {
            PackedUserOperation calldata userOp = ops[i];
            bytes32 userOpHash = getUserOpHash(userOp);

            _deploySenderIfNeeded(userOp);
            I4337Account(userOp.sender).validateUserOp(userOp, userOpHash, 0);

            address paymaster = address(0);
            bytes memory context;
            if (userOp.paymasterAndData.length > 0) {
                uint256 validationData;
                (paymaster,) = abi.decode(userOp.paymasterAndData, (address, uint256));
                (context, validationData) = I4337Paymaster(paymaster).validatePaymasterUserOp(userOp, userOpHash);
                if (validationData != 0) {
                    revert PaymasterValidationFailed();
                }
            }

            bool success = true;
            try I4337Account(userOp.sender).executeUserOp(userOp, userOpHash) {} catch (bytes memory reason) {
                success = false;
                revert AccountExecutionFailed(reason);
            }

            if (paymaster != address(0)) {
                I4337Paymaster(paymaster).postOp(context, success);
            }

            emit UserOperationHandled(userOp.sender, userOpHash, paymaster);
        }
    }

    function getUserOpHash(PackedUserOperation calldata userOp) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )
        );
    }

    function _deploySenderIfNeeded(PackedUserOperation calldata userOp) private {
        if (userOp.initCode.length == 0 || userOp.sender.code.length != 0) {
            return;
        }
        if (userOp.initCode.length < 20) {
            revert SenderDeploymentFailed();
        }

        address factory = address(bytes20(userOp.initCode[:20]));
        bytes calldata factoryCallData = userOp.initCode[20:];
        (bool success, bytes memory returnData) = factory.call(factoryCallData);
        if (!success) {
            revert SenderDeploymentFailed();
        }

        address deployedSender = abi.decode(returnData, (address));
        if (deployedSender != userOp.sender || userOp.sender.code.length == 0) {
            revert SenderAddressMismatch();
        }
    }
}
