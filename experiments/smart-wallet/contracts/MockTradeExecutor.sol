// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockTradeExecutor {
    uint256 public totalAmountIn;
    address public lastRecipient;

    event SwapExecuted(address indexed caller, uint256 amountIn, uint256 newTotal);
    event Swept(address indexed recipient);

    function swapExactInput(uint256 amountIn) external returns (uint256 amountOut) {
        totalAmountIn += amountIn;
        emit SwapExecuted(msg.sender, amountIn, totalAmountIn);
        return amountIn * 2;
    }

    function sweep(address recipient) external {
        lastRecipient = recipient;
        emit Swept(recipient);
    }
}
