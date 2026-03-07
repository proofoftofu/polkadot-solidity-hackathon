// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/WalletTypes.sol";

interface IWalletExecuteFromExecutor {
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        returns (bytes[] memory returnData);
}

contract ExecutionModule is IERC7579Module {
    function onInstall(bytes calldata) external {}

    function onUninstall(bytes calldata) external {}

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == 2;
    }

    function executeViaAccount(address account, bytes32 mode, bytes calldata executionCalldata)
        external
        returns (bytes[] memory returnData)
    {
        return IWalletExecuteFromExecutor(account).executeFromExecutor(mode, executionCalldata);
    }
}
