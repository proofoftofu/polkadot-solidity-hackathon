// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./SmartSessionWallet.sol";

interface IWalletExecute {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
}

contract SessionKeyValidatorModule is IERC7579Validator {
    bytes4 public constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 public constant ERC1271_INVALID_VALUE = 0xffffffff;

    error SessionAlreadyInstalled();
    error SessionNotInstalled();
    error SessionExpired();
    error UnauthorizedSessionCaller();
    error UnauthorizedAction();
    error CallBudgetExceeded();
    error ValueBudgetExceeded();
    error InvalidSignatureLength();

    struct SessionConfig {
        address sessionKey;
        address allowedTarget;
        bytes4 allowedSelector;
        uint64 expiresAt;
        uint32 remainingCalls;
        uint128 remainingValue;
        bool sponsorshipRequired;
        bool installed;
    }

    mapping(address account => SessionConfig config) public sessions;

    function onInstall(bytes calldata data) external {
        (
            address sessionKey,
            address allowedTarget,
            bytes4 allowedSelector,
            uint64 expiresAt,
            uint32 remainingCalls,
            uint128 remainingValue,
            bool sponsorshipRequired
        ) = abi.decode(data, (address, address, bytes4, uint64, uint32, uint128, bool));

        if (sessions[msg.sender].installed) {
            revert SessionAlreadyInstalled();
        }

        sessions[msg.sender] = SessionConfig({
            sessionKey: sessionKey,
            allowedTarget: allowedTarget,
            allowedSelector: allowedSelector,
            expiresAt: expiresAt,
            remainingCalls: remainingCalls,
            remainingValue: remainingValue,
            sponsorshipRequired: sponsorshipRequired,
            installed: true
        });
    }

    function onUninstall(bytes calldata) external {
        if (!sessions[msg.sender].installed) {
            revert SessionNotInstalled();
        }

        delete sessions[msg.sender];
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == 1;
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external view returns (uint256) {
        SessionConfig storage config = sessions[userOp.sender];
        if (!config.installed || block.timestamp > config.expiresAt) {
            return 1;
        }

        if (userOp.callData.length < 4 || bytes4(userOp.callData[:4]) != IWalletExecute.execute.selector) {
            return 1;
        }

        (bytes32 mode, bytes memory executionCalldata) = abi.decode(userOp.callData[4:], (bytes32, bytes));
        if (mode != bytes32(0)) {
            return 1;
        }

        (address target, uint256 value, bytes4 selector) = _decodeCallFromMemory(executionCalldata);
        if (target != config.allowedTarget || selector != config.allowedSelector) {
            return 1;
        }

        if (config.remainingCalls == 0 || value > uint256(config.remainingValue)) {
            return 1;
        }

        bool paymasterUsed = userOp.paymasterAndData.length > 0;
        if (config.sponsorshipRequired != paymasterUsed) {
            return 1;
        }

        (address validator, bytes memory validatorSignature) = abi.decode(userOp.signature, (address, bytes));
        if (validator != address(this)) {
            return 1;
        }

        (address sessionKey, bytes memory signedMessage) = abi.decode(validatorSignature, (address, bytes));
        if (sessionKey != config.sessionKey) {
            return 1;
        }

        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        if (_recover(digest, signedMessage) != sessionKey) {
            return 1;
        }

        return 0;
    }

    function executeSession(address account, bytes32 mode, bytes calldata executionCalldata) external {
        SessionConfig storage config = sessions[account];

        if (!config.installed) {
            revert SessionNotInstalled();
        }

        if (config.sessionKey != msg.sender) {
            revert UnauthorizedSessionCaller();
        }

        if (block.timestamp > config.expiresAt) {
            revert SessionExpired();
        }

        if (config.sponsorshipRequired || mode != bytes32(0)) {
            revert UnauthorizedAction();
        }

        (address target, uint256 value, bytes4 selector) = _decodeCallFromCalldata(executionCalldata);
        if (target != config.allowedTarget || selector != config.allowedSelector) {
            revert UnauthorizedAction();
        }

        if (config.remainingCalls == 0) {
            revert CallBudgetExceeded();
        }

        if (value > uint256(config.remainingValue)) {
            revert ValueBudgetExceeded();
        }

        config.remainingCalls -= 1;
        config.remainingValue -= uint128(value);

        IWalletExecute(account).execute(mode, executionCalldata);
    }

    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        SessionConfig storage config = sessions[msg.sender];
        if (!config.installed || block.timestamp > config.expiresAt) {
            return ERC1271_INVALID_VALUE;
        }

        (address sessionKey, bytes memory signedMessage) = abi.decode(signature, (address, bytes));
        if (sessionKey != config.sessionKey) {
            return ERC1271_INVALID_VALUE;
        }

        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        if (_recover(digest, signedMessage) == sessionKey) {
            return ERC1271_MAGIC_VALUE;
        }

        return ERC1271_INVALID_VALUE;
    }

    function _decodeCallFromMemory(bytes memory executionCalldata)
        private
        pure
        returns (address target, uint256 value, bytes4 selector)
    {
        if (executionCalldata.length < 56) {
            revert UnauthorizedAction();
        }

        assembly {
            target := shr(96, mload(add(executionCalldata, 32)))
            value := mload(add(executionCalldata, 52))
            selector := mload(add(executionCalldata, 84))
        }
    }

    function _decodeCallFromCalldata(bytes calldata executionCalldata)
        private
        pure
        returns (address target, uint256 value, bytes4 selector)
    {
        if (executionCalldata.length < 56) {
            revert UnauthorizedAction();
        }

        target = address(bytes20(executionCalldata[:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        selector = bytes4(executionCalldata[52:56]);
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address) {
        if (signature.length != 65) {
            revert InvalidSignatureLength();
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
}
