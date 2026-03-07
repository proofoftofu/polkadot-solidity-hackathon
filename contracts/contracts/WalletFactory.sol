// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentSmartWallet.sol";

contract WalletFactory {
    error WalletAlreadyExists();

    address public immutable entryPoint;
    mapping(address owner => address wallet) public wallets;

    event WalletCreated(address indexed owner, address indexed wallet);

    constructor(address entryPoint_) {
        entryPoint = entryPoint_;
    }

    function createWallet(address owner) external returns (address wallet) {
        if (wallets[owner] != address(0)) {
            revert WalletAlreadyExists();
        }

        wallet = address(new AgentSmartWallet(owner, entryPoint));
        wallets[owner] = wallet;
        emit WalletCreated(owner, wallet);
    }
}
