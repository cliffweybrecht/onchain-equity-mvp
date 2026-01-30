// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITransferPolicy } from "./policy/ITransferPolicy.sol";

contract EquityToken {
    // --- existing state ---
    address public admin;

    // Keep your existing error
    error TransferNotAllowed();

    // NEW: policy
    ITransferPolicy public transferPolicy;

    event TransferPolicyUpdated(address indexed oldPolicy, address indexed newPolicy);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NotAdmin");
        _;
    }

    constructor(
        address admin_,
        address /*registryOrOther*/,
        address policy_
    ) {
        admin = admin_;
        transferPolicy = ITransferPolicy(policy_);
    }

    function setTransferPolicy(address newPolicy) external onlyAdmin {
        require(newPolicy != address(0), "Policy=0");
        emit TransferPolicyUpdated(address(transferPolicy), newPolicy);
        transferPolicy = ITransferPolicy(newPolicy);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        // ✅ Delegate enforcement
        if (!transferPolicy.canTransfer(address(this), msg.sender, to, amount)) {
            revert TransferNotAllowed();
        }

        // --- existing transfer logic unchanged below ---
        // balances checks, update balances, emit Transfer, return true
    }
}
