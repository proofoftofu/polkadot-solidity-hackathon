// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/WalletTypes.sol";

interface IWalletExecute {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
}

contract SessionKeyValidatorModule is IERC7579Validator {
    uint8 public constant OPERATION_KIND_CALL = 0;
    uint8 public constant OPERATION_KIND_XCM_PROGRAM = 1;

    uint8 public constant ENDPOINT_KIND_EXECUTE = 0;
    uint8 public constant ENDPOINT_KIND_SEND = 1;

    uint8 public constant XCM_INSTRUCTION_WITHDRAW_ASSET = 0;
    uint8 public constant XCM_INSTRUCTION_BUY_EXECUTION = 1;
    uint8 public constant XCM_INSTRUCTION_PAY_FEES = 2;
    uint8 public constant XCM_INSTRUCTION_INITIATE_TRANSFER = 3;
    uint8 public constant XCM_INSTRUCTION_DEPOSIT_ASSET = 4;

    bytes4 public constant EXECUTE_PROGRAM_SELECTOR =
        bytes4(keccak256("executeProgram(bytes32,(uint8,uint32,(uint8,bytes32,uint128,uint32,bytes32)[]))"));
    bytes4 public constant DISPATCH_PROGRAM_SELECTOR =
        bytes4(keccak256("dispatchProgram(bytes32,(uint8,uint32,(uint8,bytes32,uint128,uint32,bytes32)[]))"));
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

    struct AssetLimit {
        bytes32 assetId;
        uint128 maxAmount;
    }

    struct XcmPolicy {
        uint256 allowedEndpointBitmap;
        uint256 allowedInstructionBitmap;
        uint32[] allowedDestinationParaIds;
        bytes32[] allowedBeneficiaries;
        AssetLimit[] assetLimits;
    }

    struct XcmInstruction {
        uint8 kind;
        bytes32 assetId;
        uint128 amount;
        uint32 paraId;
        bytes32 accountId32;
    }

    struct XcmProgram {
        uint8 endpointKind;
        uint32 endpointParaId;
        XcmInstruction[] instructions;
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
        XcmPolicy xcmPolicy;
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
        uint8[] allowedEndpointKinds;
        uint8[] allowedInstructionKinds;
        uint32[] allowedDestinationParaIds;
        bytes32[] allowedBeneficiaries;
        AssetLimit[] assetLimits;
    }

    struct XcmProgramSummary {
        uint8 endpointKind;
        bytes4 selector;
        bytes32 primaryAssetId;
        uint128 primaryAmount;
        uint32 destinationParaId;
        bytes32 beneficiaryAccountId32;
    }

    mapping(address account => SessionConfig config) private sessions;

    function onInstall(bytes calldata data) external {
        SessionInstallConfig memory config = abi.decode(data, (SessionInstallConfig));
        SessionConfig storage session = sessions[msg.sender];

        if (session.installed) {
            revert SessionAlreadyInstalled();
        }

        session.sessionKey = config.sessionKey;
        session.agentId = config.agentId;
        session.targetChainId = config.targetChainId;
        session.allowedTarget = config.allowedTarget;
        session.allowedSelector = config.allowedSelector;
        session.validUntil = config.validUntil;
        session.replayNonce = config.replayNonce;
        session.remainingCalls = config.remainingCalls;
        session.remainingValue = config.remainingValue;
        session.sponsorshipAllowed = config.sponsorshipAllowed;
        session.operationKind = config.operationKind;
        session.xcmPolicy.allowedEndpointBitmap = _endpointBitmap(config.allowedEndpointKinds);
        session.xcmPolicy.allowedInstructionBitmap = _instructionBitmap(config.allowedInstructionKinds);

        for (uint256 i = 0; i < config.allowedDestinationParaIds.length; i++) {
            session.xcmPolicy.allowedDestinationParaIds.push(config.allowedDestinationParaIds[i]);
        }
        for (uint256 i = 0; i < config.allowedBeneficiaries.length; i++) {
            session.xcmPolicy.allowedBeneficiaries.push(config.allowedBeneficiaries[i]);
        }
        for (uint256 i = 0; i < config.assetLimits.length; i++) {
            session.xcmPolicy.assetLimits.push(config.assetLimits[i]);
        }

        session.installed = true;
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

    function getSessionState(address account)
        external
        view
        returns (
            uint64 replayNonce,
            uint32 remainingCalls,
            uint128 remainingValue,
            uint8 operationKind,
            bool installed
        )
    {
        SessionConfig storage config = sessions[account];
        return (config.replayNonce, config.remainingCalls, config.remainingValue, config.operationKind, config.installed);
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
        } else if (config.operationKind == OPERATION_KIND_XCM_PROGRAM) {
            allowed = _validateXcmProgramPolicy(config, executionCalldata);
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
        } else if (config.operationKind == OPERATION_KIND_XCM_PROGRAM) {
            XcmProgramSummary memory summary = _validateAndConsumeXcmProgram(config, executionCalldata);
            config.remainingCalls -= 1;
            config.remainingValue -= summary.primaryAmount;
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

    function _validateXcmProgramPolicy(SessionConfig storage config, bytes memory executionCalldata)
        private
        view
        returns (bool)
    {
        XcmProgramSummary memory summary =
            _decodeAndSummarizeXcmProgramFromMemory(executionCalldata, config.allowedTarget, config.xcmPolicy.allowedInstructionBitmap);

        if (!_isEndpointAllowed(config.xcmPolicy.allowedEndpointBitmap, summary.endpointKind)) {
            return false;
        }
        if (!_isDestinationAllowed(config.xcmPolicy.allowedDestinationParaIds, summary.destinationParaId)) {
            return false;
        }
        if (!_isBeneficiaryAllowed(config.xcmPolicy.allowedBeneficiaries, summary.beneficiaryAccountId32)) {
            return false;
        }
        if (
            !_hasAssetAllowance(config.xcmPolicy.assetLimits, summary.primaryAssetId, summary.primaryAmount)
                || summary.primaryAmount > config.remainingValue
        ) {
            return false;
        }

        return summary.selector == (summary.endpointKind == ENDPOINT_KIND_EXECUTE ? EXECUTE_PROGRAM_SELECTOR : DISPATCH_PROGRAM_SELECTOR);
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

    function _validateAndConsumeXcmProgram(SessionConfig storage config, bytes calldata executionCalldata)
        private
        view
        returns (XcmProgramSummary memory summary)
    {
        summary = _decodeAndSummarizeXcmProgramFromCalldata(
            executionCalldata, config.allowedTarget, config.xcmPolicy.allowedInstructionBitmap
        );

        if (!_isEndpointAllowed(config.xcmPolicy.allowedEndpointBitmap, summary.endpointKind)) {
            revert UnauthorizedAction();
        }
        if (!_isDestinationAllowed(config.xcmPolicy.allowedDestinationParaIds, summary.destinationParaId)) {
            revert UnauthorizedAction();
        }
        if (!_isBeneficiaryAllowed(config.xcmPolicy.allowedBeneficiaries, summary.beneficiaryAccountId32)) {
            revert UnauthorizedAction();
        }
        if (!_hasAssetAllowance(config.xcmPolicy.assetLimits, summary.primaryAssetId, summary.primaryAmount)) {
            revert UnauthorizedAction();
        }
        if (summary.primaryAmount > uint256(config.remainingValue)) {
            revert ValueBudgetExceeded();
        }
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

    function _decodeAndSummarizeXcmProgramFromMemory(
        bytes memory executionCalldata,
        address allowedTarget,
        uint256 allowedInstructionBitmap
    )
        private
        pure
        returns (XcmProgramSummary memory)
    {
        (address target, uint256 value, bytes4 selector) = _decodeCallFromMemory(executionCalldata);
        if (target != allowedTarget || value != 0) {
            revert UnauthorizedAction();
        }
        if (selector != EXECUTE_PROGRAM_SELECTOR && selector != DISPATCH_PROGRAM_SELECTOR) {
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

        (bytes32 requestId, XcmProgram memory program) = abi.decode(params, (bytes32, XcmProgram));
        requestId;
        return _summarizeProgram(program, selector, allowedInstructionBitmap);
    }

    function _decodeAndSummarizeXcmProgramFromCalldata(
        bytes calldata executionCalldata,
        address allowedTarget,
        uint256 allowedInstructionBitmap
    )
        private
        pure
        returns (XcmProgramSummary memory)
    {
        (address target, uint256 value, bytes4 selector) = _decodeCallFromCalldata(executionCalldata);
        if (target != allowedTarget || value != 0) {
            revert UnauthorizedAction();
        }
        if (selector != EXECUTE_PROGRAM_SELECTOR && selector != DISPATCH_PROGRAM_SELECTOR) {
            revert UnauthorizedAction();
        }

        bytes memory params = new bytes(executionCalldata.length - 56);
        for (uint256 i = 0; i < params.length; i++) {
            params[i] = executionCalldata[i + 56];
        }

        (bytes32 requestId, XcmProgram memory program) = abi.decode(params, (bytes32, XcmProgram));
        requestId;
        return _summarizeProgram(program, selector, allowedInstructionBitmap);
    }

    function _summarizeProgram(XcmProgram memory program, bytes4 selector, uint256 allowedInstructionBitmap)
        private
        pure
        returns (XcmProgramSummary memory summary)
    {
        if (program.instructions.length != 4) {
            revert UnauthorizedAction();
        }

        XcmInstruction memory withdrawInstruction = program.instructions[0];
        XcmInstruction memory payFeesInstruction = program.instructions[1];
        XcmInstruction memory transferInstruction = program.instructions[2];
        XcmInstruction memory depositInstruction = program.instructions[3];

        if (
            withdrawInstruction.kind != XCM_INSTRUCTION_WITHDRAW_ASSET
                || payFeesInstruction.kind != XCM_INSTRUCTION_PAY_FEES
                || transferInstruction.kind != XCM_INSTRUCTION_INITIATE_TRANSFER
                || depositInstruction.kind != XCM_INSTRUCTION_DEPOSIT_ASSET
        ) {
            revert UnauthorizedAction();
        }
        if (
            !_isInstructionAllowed(allowedInstructionBitmap, withdrawInstruction.kind)
                || !_isInstructionAllowed(allowedInstructionBitmap, payFeesInstruction.kind)
                || !_isInstructionAllowed(allowedInstructionBitmap, transferInstruction.kind)
                || !_isInstructionAllowed(allowedInstructionBitmap, depositInstruction.kind)
        ) {
            revert UnauthorizedAction();
        }
        if (
            withdrawInstruction.amount == 0 || payFeesInstruction.amount == 0 || transferInstruction.amount == 0
                || withdrawInstruction.amount <= payFeesInstruction.amount + transferInstruction.amount
        ) {
            revert UnauthorizedAction();
        }
        if (
            (selector == EXECUTE_PROGRAM_SELECTOR && program.endpointKind != ENDPOINT_KIND_EXECUTE)
                || (selector == DISPATCH_PROGRAM_SELECTOR && program.endpointKind != ENDPOINT_KIND_SEND)
        ) {
            revert UnauthorizedAction();
        }
        if (transferInstruction.paraId == 0 || depositInstruction.accountId32 == bytes32(0)) {
            revert UnauthorizedAction();
        }

        summary = XcmProgramSummary({
            endpointKind: program.endpointKind,
            selector: selector,
            primaryAssetId: withdrawInstruction.assetId,
            primaryAmount: withdrawInstruction.amount,
            destinationParaId: transferInstruction.paraId,
            beneficiaryAccountId32: depositInstruction.accountId32
        });
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

    function _instructionBitmap(uint8[] memory instructionKinds) private pure returns (uint256 bitmap) {
        for (uint256 i = 0; i < instructionKinds.length; i++) {
            bitmap |= _instructionBit(instructionKinds[i]);
        }
    }

    function _endpointBitmap(uint8[] memory endpointKinds) private pure returns (uint256 bitmap) {
        for (uint256 i = 0; i < endpointKinds.length; i++) {
            bitmap |= (1 << endpointKinds[i]);
        }
    }

    function _instructionBit(uint8 instructionKind) private pure returns (uint256) {
        return 1 << instructionKind;
    }

    function _isInstructionAllowed(uint256 bitmap, uint8 instructionKind) private pure returns (bool) {
        return (bitmap & _instructionBit(instructionKind)) != 0;
    }

    function _isEndpointAllowed(uint256 bitmap, uint8 endpointKind) private pure returns (bool) {
        return (bitmap & (1 << endpointKind)) != 0;
    }

    function _isDestinationAllowed(uint32[] storage allowedDestinations, uint32 destinationParaId)
        private
        view
        returns (bool)
    {
        if (allowedDestinations.length == 0) {
            return true;
        }
        for (uint256 i = 0; i < allowedDestinations.length; i++) {
            if (allowedDestinations[i] == destinationParaId) {
                return true;
            }
        }
        return false;
    }

    function _isBeneficiaryAllowed(bytes32[] storage allowedBeneficiaries, bytes32 beneficiaryAccountId32)
        private
        view
        returns (bool)
    {
        if (allowedBeneficiaries.length == 0) {
            return true;
        }
        for (uint256 i = 0; i < allowedBeneficiaries.length; i++) {
            if (allowedBeneficiaries[i] == beneficiaryAccountId32) {
                return true;
            }
        }
        return false;
    }

    function _hasAssetAllowance(AssetLimit[] storage assetLimits, bytes32 assetId, uint128 amount)
        private
        view
        returns (bool)
    {
        for (uint256 i = 0; i < assetLimits.length; i++) {
            if (assetLimits[i].assetId == assetId) {
                return amount <= assetLimits[i].maxAmount;
            }
        }
        return false;
    }
}
