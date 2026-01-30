// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface expected by CompositePolicyV111.
/// IMPORTANT: match function names/signatures exactly.
interface ITransferPolicyV2 {
    function canTransfer(address token, address from, address to, uint256 amount) external view returns (bool);
    function canTransferTrace(address token, address from, address to, uint256 amount)
        external
        view
        returns (bool ok, uint256 failedPolicyIndex, address failedPolicy);
}

/**
 * @title EmergencyFreezePolicyV2
 * @notice Break-glass global transfer freeze policy compatible with ITransferPolicyV2.
 * - frozen=true => blocks ALL transfers
 * - frozen=false => passes (other policies decide)
 */
contract EmergencyFreezePolicyV2 is ITransferPolicyV2 {
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

    /// @notice When frozen -> false. When not frozen -> true.
    function canTransfer(address, address, address, uint256) external view returns (bool) {
        return !frozen;
    }

    /// @notice Trace info: if blocked, we point to ourselves.
    function canTransferTrace(address, address, address, uint256)
        external
        view
        returns (bool ok, uint256 failedPolicyIndex, address failedPolicy)
    {
        if (frozen) {
            return (false, 0, address(this));
        }
        return (true, type(uint256).max, address(0));
    }
}
