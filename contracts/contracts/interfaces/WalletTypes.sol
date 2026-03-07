// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

interface IERC7579Execution {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;

    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        returns (bytes[] memory returnData);
}

interface IERC7579AccountConfig {
    function accountId() external view returns (string memory accountImplementationId);

    function supportsExecutionMode(bytes32 encodedMode) external view returns (bool);

    function supportsModule(uint256 moduleTypeId) external view returns (bool);
}

interface IERC7579ModuleConfig {
    event ModuleInstalled(uint256 moduleTypeId, address module);
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;

    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext)
        external
        view
        returns (bool);
}

interface IERC7579Module {
    function onInstall(bytes calldata data) external;

    function onUninstall(bytes calldata data) external;

    function isModuleType(uint256 moduleTypeId) external view returns (bool);
}

interface IERC7579Validator is IERC7579Module {
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external returns (uint256);

    function isValidSignatureWithSender(address sender, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4);
}
