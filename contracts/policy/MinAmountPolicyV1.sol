// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITransferPolicy } from "./ITransferPolicy.sol";

/// @notice MinAmountPolicyV1: allows transfers only if amount >= minAmount.
/// @dev Simple, deterministic policy to prove AND-stacking + trace behavior.
contract MinAmountPolicyV1 is ITransferPolicy {
    address public admin;
    uint256 public minAmount;

    error NotAdmin();
    error ZeroAdmin();

    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event MinAmountUpdated(uint256 oldMinAmount, uint256 newMinAmount);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_, uint256 minAmount_) {
        if (admin_ == address(0)) revert ZeroAdmin();
        admin = admin_;
        minAmount = minAmount_;
        emit MinAmountUpdated(0, minAmount_);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAdmin();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setMinAmount(uint256 newMinAmount) external onlyAdmin {
        emit MinAmountUpdated(minAmount, newMinAmount);
        minAmount = newMinAmount;
    }

    /// @notice Policy decision. Token semantics remain boolean.
    function canTransfer(
        address /* token */,
        address /* from */,
        address /* to */,
        uint256 amount
    ) external view override returns (bool) {
        return amount >= minAmount;
    }
}
