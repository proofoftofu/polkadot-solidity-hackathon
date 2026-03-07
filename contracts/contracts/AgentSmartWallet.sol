// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/WalletTypes.sol";

contract AgentSmartWallet is IERC1271, IERC7579Execution, IERC7579AccountConfig, IERC7579ModuleConfig {
    uint256 public constant MODULE_TYPE_VALIDATOR = 1;
    uint256 public constant MODULE_TYPE_EXECUTOR = 2;

    error NotOwner();
    error NotEntryPoint();
    error UnsupportedModuleType();
    error UnsupportedExecutionMode();
    error ModuleTypeMismatch();
    error ModuleAlreadyInstalled();
    error ModuleNotInstalled();
    error UnauthorizedCaller();
    error UnauthorizedBootstrap();
    error InvalidExecutionCalldata();
    error ExecutionFailed(bytes reason);
    error InvalidValidatorSelection();
    error InvalidUserOpSender();
    error InvalidUserOpNonce();
    error UserOpValidationFailed();

    address public immutable owner;
    address public immutable entryPoint;
    uint256 public nonce;
    uint256 private _installedValidatorCount;

    mapping(uint256 moduleTypeId => mapping(address module => bool installed)) private _installedModules;

    event Executed(address indexed caller, address indexed target, bytes4 indexed selector, uint256 value);
    event UserOperationValidated(bytes32 indexed userOpHash, address indexed validator, uint256 nonce);
    event UserOperationExecuted(bytes32 indexed userOpHash, address indexed validator);

    constructor(address owner_, address entryPoint_) payable {
        owner = owner_;
        entryPoint = entryPoint_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) {
            revert NotEntryPoint();
        }
        _;
    }

    function accountId() external pure returns (string memory accountImplementationId) {
        return "tofu.agent-smart-wallet.erc7579.v1";
    }

    function supportsExecutionMode(bytes32 encodedMode) public pure returns (bool) {
        (bytes1 callType, bytes1 execType, uint32 unused,,) = _unpackMode(encodedMode);
        return callType == 0x00 && execType == 0x00 && unused == 0;
    }

    function supportsModule(uint256 moduleTypeId) public pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR || moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external onlyOwner {
        _installModule(moduleTypeId, module, initData);
    }

    function bootstrapInstallModule(uint256 moduleTypeId, address module, bytes calldata initData) external {
        if (msg.sender != address(this) || _installedValidatorCount != 0) {
            revert UnauthorizedBootstrap();
        }
        _installModule(moduleTypeId, module, initData);
    }

    function _installModule(uint256 moduleTypeId, address module, bytes calldata initData) internal {
        if (!supportsModule(moduleTypeId)) {
            revert UnsupportedModuleType();
        }
        if (_installedModules[moduleTypeId][module]) {
            revert ModuleAlreadyInstalled();
        }
        if (!IERC7579Module(module).isModuleType(moduleTypeId)) {
            revert ModuleTypeMismatch();
        }

        _installedModules[moduleTypeId][module] = true;
        if (moduleTypeId == MODULE_TYPE_VALIDATOR) {
            _installedValidatorCount += 1;
        }
        IERC7579Module(module).onInstall(initData);
        emit ModuleInstalled(moduleTypeId, module);
    }

    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external onlyOwner {
        if (!_installedModules[moduleTypeId][module]) {
            revert ModuleNotInstalled();
        }

        IERC7579Module(module).onUninstall(deInitData);
        _installedModules[moduleTypeId][module] = false;
        if (moduleTypeId == MODULE_TYPE_VALIDATOR) {
            _installedValidatorCount -= 1;
        }
        emit ModuleUninstalled(moduleTypeId, module);
    }

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool) {
        return _installedModules[moduleTypeId][module];
    }

    function execute(bytes32 mode, bytes calldata executionCalldata) external payable {
        if (
            msg.sender != owner && msg.sender != entryPoint && msg.sender != address(this)
                && !_installedModules[MODULE_TYPE_VALIDATOR][msg.sender]
        ) {
            revert UnauthorizedCaller();
        }
        if (!supportsExecutionMode(mode)) {
            revert UnsupportedExecutionMode();
        }

        _executeSingle(executionCalldata);
    }

    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        returns (bytes[] memory returnData)
    {
        if (!_installedModules[MODULE_TYPE_EXECUTOR][msg.sender]) {
            revert UnauthorizedCaller();
        }
        if (!supportsExecutionMode(mode)) {
            revert UnsupportedExecutionMode();
        }

        returnData = new bytes[](1);
        returnData[0] = _executeSingle(executionCalldata);
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256)
        external
        onlyEntryPoint
        returns (uint256 validationData)
    {
        if (userOp.sender != address(this)) {
            revert InvalidUserOpSender();
        }
        if (userOp.nonce != nonce) {
            revert InvalidUserOpNonce();
        }

        (address validator,) = abi.decode(userOp.signature, (address, bytes));
        if (validator == address(0)) {
            if (!_validateBootstrapUserOp(userOp, userOpHash)) {
                revert UserOpValidationFailed();
            }
        } else {
            if (!_installedModules[MODULE_TYPE_VALIDATOR][validator]) {
                revert InvalidValidatorSelection();
            }

            validationData = IERC7579Validator(validator).validateUserOp(userOp, userOpHash);
            if (validationData != 0) {
                revert UserOpValidationFailed();
            }
        }

        nonce += 1;
        emit UserOperationValidated(userOpHash, validator, userOp.nonce);
    }

    function executeUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external onlyEntryPoint {
        (address validator,) = abi.decode(userOp.signature, (address, bytes));

        (bool success, bytes memory returnData) = address(this).call(userOp.callData);
        if (!success) {
            revert ExecutionFailed(returnData);
        }

        emit UserOperationExecuted(userOpHash, validator);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address validator, bytes memory validatorSignature) = abi.decode(signature, (address, bytes));
        if (!_installedModules[MODULE_TYPE_VALIDATOR][validator]) {
            revert InvalidValidatorSelection();
        }

        return IERC7579Validator(validator).isValidSignatureWithSender(msg.sender, hash, validatorSignature);
    }

    function _executeSingle(bytes calldata executionCalldata) internal returns (bytes memory result) {
        (address target, uint256 value, bytes calldata callData) = _decodeSingleExecution(executionCalldata);
        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        if (!success) {
            revert ExecutionFailed(returnData);
        }

        emit Executed(msg.sender, target, _selector(callData), value);
        return returnData;
    }

    function _decodeSingleExecution(bytes calldata executionCalldata)
        private
        pure
        returns (address target, uint256 value, bytes calldata callData)
    {
        if (executionCalldata.length < 52) {
            revert InvalidExecutionCalldata();
        }

        target = address(bytes20(executionCalldata[:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector_) {
        if (data.length < 4) {
            return bytes4(0);
        }
        assembly {
            selector_ := calldataload(data.offset)
        }
    }

    function _unpackMode(bytes32 mode)
        private
        pure
        returns (bytes1 callType, bytes1 execType, uint32 unused, bytes4 modeSelector, bytes22 payload)
    {
        uint256 raw = uint256(mode);
        callType = bytes1(uint8(raw >> 248));
        execType = bytes1(uint8(raw >> 240));
        unused = uint32(raw >> 208);
        modeSelector = bytes4(uint32(raw >> 176));
        payload = bytes22(uint176(raw));
    }

    function _validateBootstrapUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        private
        view
        returns (bool)
    {
        if (_installedValidatorCount != 0 || nonce != 0 || userOp.initCode.length == 0) {
            return false;
        }

        (, bytes memory ownerSignature) = abi.decode(userOp.signature, (address, bytes));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encode(userOpHash, address(this), block.chainid))));
        return _recover(digest, ownerSignature) == owner;
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address) {
        if (signature.length != 65) {
            revert InvalidValidatorSelection();
        }

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        return ecrecover(digest, v, r, s);
    }

    receive() external payable {}
}
