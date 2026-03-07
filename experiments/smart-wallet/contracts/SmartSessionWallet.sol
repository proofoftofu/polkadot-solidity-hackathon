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

interface ISimplePaymaster {
    function consumeSponsorCharge(address account, uint256 sponsorCharge) external;
}

contract SmartSessionWallet is IERC1271, IERC7579Execution, IERC7579AccountConfig, IERC7579ModuleConfig {
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
    error InvalidExecutionCalldata();
    error ExecutionFailed(bytes reason);
    error InvalidValidatorSelection();
    error UserOpSenderMismatch();
    error UserOpValidationFailed();
    error InvalidPaymasterSelection();

    address public immutable owner;
    address public immutable entryPoint;

    mapping(uint256 moduleTypeId => mapping(address module => bool installed)) private _installedModules;

    event Executed(address indexed caller, address indexed target, bytes4 indexed selector, uint256 value);
    event UserOperationExecuted(bytes32 indexed userOpHash, address indexed validator, address indexed paymaster);

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
        return "tofu.smart-session-wallet.erc7579.v1";
    }

    function supportsExecutionMode(bytes32 encodedMode) public pure returns (bool) {
        (bytes1 callType, bytes1 execType, uint32 unused,,) = _unpackMode(encodedMode);
        return callType == 0x00 && execType == 0x00 && unused == 0;
    }

    function supportsModule(uint256 moduleTypeId) public pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR || moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external onlyOwner {
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
        IERC7579Module(module).onInstall(initData);
        emit ModuleInstalled(moduleTypeId, module);
    }

    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external onlyOwner {
        if (!_installedModules[moduleTypeId][module]) {
            revert ModuleNotInstalled();
        }

        IERC7579Module(module).onUninstall(deInitData);
        _installedModules[moduleTypeId][module] = false;
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

    function executeUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external onlyEntryPoint {
        if (userOp.sender != address(this)) {
            revert UserOpSenderMismatch();
        }

        (address validator,) = abi.decode(userOp.signature, (address, bytes));
        if (!_installedModules[MODULE_TYPE_VALIDATOR][validator]) {
            revert InvalidValidatorSelection();
        }

        if (IERC7579Validator(validator).validateUserOp(userOp, userOpHash) != 0) {
            revert UserOpValidationFailed();
        }

        address paymaster = address(0);
        if (userOp.paymasterAndData.length > 0) {
            uint256 sponsorCharge;
            (paymaster, sponsorCharge) = abi.decode(userOp.paymasterAndData, (address, uint256));

            if (paymaster.code.length == 0) {
                revert InvalidPaymasterSelection();
            }

            ISimplePaymaster(paymaster).consumeSponsorCharge(address(this), sponsorCharge);
        }

        (bool success, bytes memory returnData) = address(this).call(userOp.callData);
        if (!success) {
            revert ExecutionFailed(returnData);
        }

        emit UserOperationExecuted(userOpHash, validator, paymaster);
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

    receive() external payable {}
}
