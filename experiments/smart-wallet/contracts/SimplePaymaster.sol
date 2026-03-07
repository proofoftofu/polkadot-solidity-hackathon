// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract SimplePaymaster {
    error NotSponsor();
    error AccountNotAllowed();
    error InvalidCaller();
    error BudgetExceeded();

    address public immutable sponsor;
    uint256 public sponsorBudget;

    mapping(address account => bool allowed) public allowedAccounts;

    event SponsorBudgetDeposited(address indexed sponsor, uint256 amount, uint256 newBudget);
    event AccountAllowanceUpdated(address indexed account, bool allowed);
    event SponsorChargeConsumed(address indexed account, uint256 amount, uint256 remainingBudget);

    constructor(address sponsor_) {
        sponsor = sponsor_;
    }

    modifier onlySponsor() {
        if (msg.sender != sponsor) {
            revert NotSponsor();
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

    function consumeSponsorCharge(address account, uint256 sponsorCharge) external {
        if (msg.sender != account) {
            revert InvalidCaller();
        }

        if (!allowedAccounts[account]) {
            revert AccountNotAllowed();
        }

        if (sponsorCharge > sponsorBudget) {
            revert BudgetExceeded();
        }

        sponsorBudget -= sponsorCharge;
        emit SponsorChargeConsumed(account, sponsorCharge, sponsorBudget);
    }
}
