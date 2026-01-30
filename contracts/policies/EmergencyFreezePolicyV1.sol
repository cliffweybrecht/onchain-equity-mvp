// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface expected by your CompositePolicy.
/// If your repo uses a different function signature, adapt ONLY the signature,
/// keep the logic identical.
interface ITransferPolicy {
    function checkTransfer(address from, address to, uint256 amount) external view returns (bool);
}

/**
 * @title EmergencyFreezePolicyV1
 * @notice Break-glass global transfer freeze policy.
 * - When frozen: blocks ALL transfers (except optional admin bypass if you want later).
 * - When unfrozen: allows transfers (does not override other policies).
 */
contract EmergencyFreezePolicyV1 is ITransferPolicy {
    error NotEmergencyAdmin();
    error AlreadyFrozen();
    error NotFrozen();

    event EmergencyAdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event EmergencyFreezeActivated(address indexed admin, string reason);
    event EmergencyFreezeReleased(address indexed admin, string reason);

    address public emergencyAdmin;
    bool public frozen;

    constructor(address _emergencyAdmin) {
        require(_emergencyAdmin != address(0), "bad admin");
        emergencyAdmin = _emergencyAdmin;
    }

    modifier onlyEmergencyAdmin() {
        if (msg.sender != emergencyAdmin) revert NotEmergencyAdmin();
        _;
    }

    function setEmergencyAdmin(address newAdmin) external onlyEmergencyAdmin {
        require(newAdmin != address(0), "bad admin");
        address old = emergencyAdmin;
        emergencyAdmin = newAdmin;
        emit EmergencyAdminUpdated(old, newAdmin);
    }

    function emergencyFreeze(string calldata reason) external onlyEmergencyAdmin {
        if (frozen) revert AlreadyFrozen();
        frozen = true;
        emit EmergencyFreezeActivated(msg.sender, reason);
    }

    function emergencyUnfreeze(string calldata reason) external onlyEmergencyAdmin {
        if (!frozen) revert NotFrozen();
        frozen = false;
        emit EmergencyFreezeReleased(msg.sender, reason);
    }

    /// @notice Policy check. When frozen -> always false.
    function checkTransfer(address, address, uint256) external view returns (bool) {
        return !frozen;
    }
}
