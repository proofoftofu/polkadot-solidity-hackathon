// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockTarget {
    uint256 public totalAmountIn;
    address public lastRecipient;
    bytes32 public lastMemo;

    event SwapExecuted(address indexed caller, uint256 amountIn, uint256 newTotal);
    event Swept(address indexed recipient);
    event MemoRecorded(bytes32 indexed memo);

    function swapExactInput(uint256 amountIn) external returns (uint256 amountOut) {
        totalAmountIn += amountIn;
        emit SwapExecuted(msg.sender, amountIn, totalAmountIn);
        return amountIn * 2;
    }

    function sweep(address recipient) external {
        lastRecipient = recipient;
        emit Swept(recipient);
    }

    function recordMemo(bytes32 memo) external {
        lastMemo = memo;
        emit MemoRecorded(memo);
    }
}
