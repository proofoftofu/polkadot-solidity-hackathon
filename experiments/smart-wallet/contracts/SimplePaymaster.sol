// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./SmartSessionWallet.sol";

contract SimplePaymaster {
    error NotSponsor();
    error NotEntryPoint();
    error AccountNotAllowed();
    error InvalidPaymasterData();
    error BudgetExceeded();

    address public immutable sponsor;
    address public immutable entryPoint;
    uint256 public sponsorBudget;

    mapping(address account => bool allowed) public allowedAccounts;

    event SponsorBudgetDeposited(address indexed sponsor, uint256 amount, uint256 newBudget);
    event AccountAllowanceUpdated(address indexed account, bool allowed);
    event UserOperationSponsored(address indexed account, bytes32 indexed userOpHash, uint256 amount);

    constructor(address sponsor_, address entryPoint_) {
        sponsor = sponsor_;
        entryPoint = entryPoint_;
    }

    modifier onlySponsor() {
        if (msg.sender != sponsor) {
            revert NotSponsor();
        }
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) {
            revert NotEntryPoint();
        }
        _;
    }

    function deposit() external payable onlySponsor {
        sponsorBudget += msg.value;
        emit SponsorBudgetDeposited(msg.sender, msg.value, sponsorBudget);
    }

    function setAccountAllowance(address account, bool allowed) external onlySponsor {
        allowedAccounts[account] = allowed;
        emit AccountAllowanceUpdated(account, allowed);
    }

    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        onlyEntryPoint
        returns (bytes memory context, uint256 validationData)
    {
        (address paymasterAddress, uint256 sponsorCharge) = abi.decode(userOp.paymasterAndData, (address, uint256));
        if (paymasterAddress != address(this)) {
            revert InvalidPaymasterData();
        }

        if (!allowedAccounts[userOp.sender]) {
            revert AccountNotAllowed();
        }

        if (sponsorCharge > sponsorBudget) {
            revert BudgetExceeded();
        }

        sponsorBudget -= sponsorCharge;
        emit UserOperationSponsored(userOp.sender, userOpHash, sponsorCharge);
        return (abi.encode(userOp.sender, sponsorCharge), 0);
    }

    function postOp(bytes calldata, bool) external onlyEntryPoint {}
}
