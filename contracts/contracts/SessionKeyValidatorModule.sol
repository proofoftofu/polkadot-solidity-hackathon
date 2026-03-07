// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/WalletTypes.sol";

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
    error WrongChain();
    error InvalidSignatureLength();

    struct SessionConfig {
        address sessionKey;
        bytes32 agentId;
        uint256 targetChainId;
        address allowedTarget;
        bytes4 allowedSelector;
        uint64 validUntil;
        uint64 replayNonce;
        uint32 remainingCalls;
        uint128 remainingValue;
        bool sponsorshipAllowed;
        bool installed;
    }

    mapping(address account => SessionConfig config) public sessions;

    function onInstall(bytes calldata data) external {
        (
            address sessionKey,
            bytes32 agentId,
            uint256 targetChainId,
            address allowedTarget,
            bytes4 allowedSelector,
            uint64 validUntil,
            uint64 replayNonce,
            uint32 remainingCalls,
            uint128 remainingValue,
            bool sponsorshipAllowed
        ) = abi.decode(data, (address, bytes32, uint256, address, bytes4, uint64, uint64, uint32, uint128, bool));

        if (sessions[msg.sender].installed) {
            revert SessionAlreadyInstalled();
        }

        sessions[msg.sender] = SessionConfig({
            sessionKey: sessionKey,
            agentId: agentId,
            targetChainId: targetChainId,
            allowedTarget: allowedTarget,
            allowedSelector: allowedSelector,
            validUntil: validUntil,
            replayNonce: replayNonce,
            remainingCalls: remainingCalls,
            remainingValue: remainingValue,
            sponsorshipAllowed: sponsorshipAllowed,
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
        if (!_canUseSession(config)) {
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
        if (
            config.targetChainId != block.chainid || target != config.allowedTarget || selector != config.allowedSelector
                || config.remainingCalls == 0 || value > uint256(config.remainingValue)
        ) {
            return 1;
        }

        bool paymasterUsed = userOp.paymasterAndData.length > 0;
        if (config.sponsorshipAllowed != paymasterUsed) {
            return 1;
        }

        (address validator, bytes memory validatorSignature) = abi.decode(userOp.signature, (address, bytes));
        if (validator != address(this)) {
            return 1;
        }

        if (!_verifySessionSignature(config, userOpHash, validatorSignature)) {
            return 1;
        }

        return 0;
    }

    function executeSession(address account, bytes32 mode, bytes calldata executionCalldata, uint256 chainId) external {
        SessionConfig storage config = sessions[account];
        if (!_canUseSession(config)) {
            revert SessionNotInstalled();
        }
        if (config.sessionKey != msg.sender) {
            revert UnauthorizedSessionCaller();
        }
        if (block.timestamp > config.validUntil) {
            revert SessionExpired();
        }
        if (chainId != config.targetChainId) {
            revert WrongChain();
        }
        if (mode != bytes32(0) || config.sponsorshipAllowed) {
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
        config.replayNonce += 1;

        IWalletExecute(account).execute(mode, executionCalldata);
    }

    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        SessionConfig storage config = sessions[msg.sender];
        if (!_canUseSession(config)) {
            return ERC1271_INVALID_VALUE;
        }
        return _verifySessionSignature(config, hash, signature) ? ERC1271_MAGIC_VALUE : ERC1271_INVALID_VALUE;
    }

    function _canUseSession(SessionConfig storage config) private view returns (bool) {
        return config.installed && block.timestamp <= config.validUntil;
    }

    function _verifySessionSignature(SessionConfig storage config, bytes32 hash, bytes memory signature)
        private
        view
        returns (bool)
    {
        (address sessionKey, bytes memory signedMessage) = abi.decode(signature, (address, bytes));
        if (sessionKey != config.sessionKey) {
            return false;
        }

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(hash, config.agentId, config.targetChainId, config.replayNonce))
            )
        );
        return _recover(digest, signedMessage) == sessionKey;
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
