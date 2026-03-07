// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./SmartSessionWallet.sol";

interface IExecuteUserOpAccount {
    function executeUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external;
}

contract MockEntryPoint {
    function handleUserOp(address account, PackedUserOperation calldata userOp, bytes32 userOpHash) external {
        IExecuteUserOpAccount(account).executeUserOp(userOp, userOpHash);
    }
}
