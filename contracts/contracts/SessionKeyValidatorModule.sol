// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/WalletTypes.sol";

interface IWalletExecute {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
}

contract SessionKeyValidatorModule is IERC7579Validator {
    uint8 public constant OPERATION_KIND_CALL = 0;
    uint8 public constant OPERATION_KIND_XCM_TELEPORT = 1;
    bytes4 public constant EXECUTE_TELEPORT_SELECTOR = bytes4(keccak256("executeTeleport(bytes32,(uint32,bytes32,uint128,uint128,uint128))"));
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
    error UnsupportedOperationKind();

    struct TeleportPolicy {
        uint32 destinationParaId;
        bytes32 beneficiaryAccountId32;
        uint128 maxTeleportAmount;
        uint128 maxLocalFee;
        uint128 maxRemoteFee;
    }

    struct TeleportConfig {
        uint32 destinationParaId;
        bytes32 beneficiaryAccountId32;
        uint128 amount;
        uint128 localFee;
        uint128 remoteFee;
    }

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
        uint8 operationKind;
        TeleportPolicy teleportPolicy;
        bool installed;
    }

    struct SessionInstallConfig {
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
        uint8 operationKind;
        TeleportPolicy teleportPolicy;
    }

    mapping(address account => SessionConfig config) public sessions;

    function onInstall(bytes calldata data) external {
        SessionInstallConfig memory config = abi.decode(data, (SessionInstallConfig));

        if (sessions[msg.sender].installed) {
            revert SessionAlreadyInstalled();
        }

        sessions[msg.sender] = SessionConfig({
            sessionKey: config.sessionKey,
            agentId: config.agentId,
            targetChainId: config.targetChainId,
            allowedTarget: config.allowedTarget,
            allowedSelector: config.allowedSelector,
            validUntil: config.validUntil,
            replayNonce: config.replayNonce,
            remainingCalls: config.remainingCalls,
            remainingValue: config.remainingValue,
            sponsorshipAllowed: config.sponsorshipAllowed,
            operationKind: config.operationKind,
            teleportPolicy: config.teleportPolicy,
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

        if (config.targetChainId != block.chainid || config.remainingCalls == 0) {
            return 1;
        }

        bool allowed;
        if (config.operationKind == OPERATION_KIND_CALL) {
            allowed = _validateDirectCallPolicy(config, executionCalldata);
        } else if (config.operationKind == OPERATION_KIND_XCM_TELEPORT) {
            allowed = _validateTeleportPolicy(config, executionCalldata);
        } else {
            return 1;
        }
        if (!allowed) {
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

        if (config.operationKind == OPERATION_KIND_CALL) {
            uint256 value = _validateAndConsumeDirectCall(config, executionCalldata);
            config.remainingCalls -= 1;
            config.remainingValue -= uint128(value);
        } else if (config.operationKind == OPERATION_KIND_XCM_TELEPORT) {
            uint128 amount = _validateAndConsumeTeleport(config, executionCalldata);
            config.remainingCalls -= 1;
            config.remainingValue -= amount;
        } else {
            revert UnsupportedOperationKind();
        }

        config.replayNonce += 1;

        IWalletExecute(account).execute(mode, executionCalldata);
    }

    function _validateDirectCallPolicy(SessionConfig storage config, bytes memory executionCalldata)
        private
        view
        returns (bool)
    {
        (address target, uint256 value, bytes4 selector) = _decodeCallFromMemory(executionCalldata);
        return target == config.allowedTarget && selector == config.allowedSelector
            && value <= uint256(config.remainingValue);
    }

    function _validateTeleportPolicy(SessionConfig storage config, bytes memory executionCalldata)
        private
        view
        returns (bool)
    {
        (
            address target,
            uint256 value,
            bytes4 selector,
            uint32 destinationParaId,
            bytes32 beneficiaryAccountId32,
            uint128 amount,
            uint128 localFee,
            uint128 remoteFee
        ) = _decodeTeleportFromMemory(executionCalldata);

        if (target != config.allowedTarget || value != 0 || selector != EXECUTE_TELEPORT_SELECTOR) {
            return false;
        }
        if (destinationParaId != config.teleportPolicy.destinationParaId) {
            return false;
        }
        if (config.teleportPolicy.beneficiaryAccountId32 != bytes32(0)) {
            if (beneficiaryAccountId32 != config.teleportPolicy.beneficiaryAccountId32) {
                return false;
            }
        }
        return amount <= config.teleportPolicy.maxTeleportAmount && amount <= config.remainingValue
            && localFee <= config.teleportPolicy.maxLocalFee && remoteFee <= config.teleportPolicy.maxRemoteFee;
    }

    function _validateAndConsumeDirectCall(SessionConfig storage config, bytes calldata executionCalldata)
        private
        view
        returns (uint256 value)
    {
        (address target, uint256 callValue, bytes4 selector) = _decodeCallFromCalldata(executionCalldata);
        if (target != config.allowedTarget || selector != config.allowedSelector) {
            revert UnauthorizedAction();
        }
        if (callValue > uint256(config.remainingValue)) {
            revert ValueBudgetExceeded();
        }
        return callValue;
    }

    function _validateAndConsumeTeleport(SessionConfig storage config, bytes calldata executionCalldata)
        private
        view
        returns (uint128 amount)
    {
        (
            address target,
            uint256 value,
            bytes4 selector,
            uint32 destinationParaId,
            bytes32 beneficiaryAccountId32,
            uint128 teleportAmount,
            uint128 localFee,
            uint128 remoteFee
        ) = _decodeTeleportFromCalldata(executionCalldata);

        if (target != config.allowedTarget || value != 0 || selector != EXECUTE_TELEPORT_SELECTOR) {
            revert UnauthorizedAction();
        }
        if (destinationParaId != config.teleportPolicy.destinationParaId) {
            revert UnauthorizedAction();
        }
        if (
            config.teleportPolicy.beneficiaryAccountId32 != bytes32(0)
                && beneficiaryAccountId32 != config.teleportPolicy.beneficiaryAccountId32
        ) {
            revert UnauthorizedAction();
        }
        if (teleportAmount > uint256(config.remainingValue)) {
            revert ValueBudgetExceeded();
        }
        if (
            teleportAmount > config.teleportPolicy.maxTeleportAmount || localFee > config.teleportPolicy.maxLocalFee
                || remoteFee > config.teleportPolicy.maxRemoteFee
        ) {
            revert UnauthorizedAction();
        }
        return teleportAmount;
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

    function _decodeTeleportFromMemory(bytes memory executionCalldata)
        private
        pure
        returns (
            address target,
            uint256 value,
            bytes4 selector,
            uint32 destinationParaId,
            bytes32 beneficiaryAccountId32,
            uint128 amount,
            uint128 localFee,
            uint128 remoteFee
        )
    {
        (target, value, selector) = _decodeCallFromMemory(executionCalldata);
        if (selector != EXECUTE_TELEPORT_SELECTOR) {
            revert UnauthorizedAction();
        }

        bytes memory callData = new bytes(executionCalldata.length - 52);
        for (uint256 i = 0; i < callData.length; i++) {
            callData[i] = executionCalldata[i + 52];
        }

        bytes memory params = new bytes(callData.length - 4);
        for (uint256 i = 0; i < params.length; i++) {
            params[i] = callData[i + 4];
        }

        TeleportConfig memory config;
        (, config) = abi.decode(params, (bytes32, TeleportConfig));
        destinationParaId = config.destinationParaId;
        beneficiaryAccountId32 = config.beneficiaryAccountId32;
        amount = config.amount;
        localFee = config.localFee;
        remoteFee = config.remoteFee;
    }

    function _decodeTeleportFromCalldata(bytes calldata executionCalldata)
        private
        pure
        returns (
            address target,
            uint256 value,
            bytes4 selector,
            uint32 destinationParaId,
            bytes32 beneficiaryAccountId32,
            uint128 amount,
            uint128 localFee,
            uint128 remoteFee
        )
    {
        (target, value, selector) = _decodeCallFromCalldata(executionCalldata);
        if (selector != EXECUTE_TELEPORT_SELECTOR) {
            revert UnauthorizedAction();
        }

        TeleportConfig memory config;
        (, config) = abi.decode(executionCalldata[56:], (bytes32, TeleportConfig));
        destinationParaId = config.destinationParaId;
        beneficiaryAccountId32 = config.beneficiaryAccountId32;
        amount = config.amount;
        localFee = config.localFee;
        remoteFee = config.remoteFee;
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
