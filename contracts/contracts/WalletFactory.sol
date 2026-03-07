// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentSmartWallet.sol";

contract WalletFactory {
    error WalletAlreadyExists();
    error WalletDeploymentFailed();

    address public immutable entryPoint;
    mapping(address owner => address wallet) public wallets;

    event WalletCreated(address indexed owner, address indexed wallet);

    constructor(address entryPoint_) {
        entryPoint = entryPoint_;
    }

    function predictWallet(address owner) public view returns (address predicted) {
        bytes32 salt = _walletSalt(owner);
        bytes memory bytecode = abi.encodePacked(type(AgentSmartWallet).creationCode, abi.encode(owner, entryPoint));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode)));
        predicted = address(uint160(uint256(hash)));
    }

    function createWallet(address owner) external returns (address wallet) {
        if (wallets[owner] != address(0)) {
            revert WalletAlreadyExists();
        }

        wallet = predictWallet(owner);
        bytes32 salt = _walletSalt(owner);
        AgentSmartWallet deployed = new AgentSmartWallet{salt: salt}(owner, entryPoint);
        if (address(deployed) != wallet) {
            revert WalletDeploymentFailed();
        }
        wallets[owner] = wallet;
        emit WalletCreated(owner, wallet);
    }

    function _walletSalt(address owner) private pure returns (bytes32) {
        return keccak256(abi.encode(owner));
    }
}
