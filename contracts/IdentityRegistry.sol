// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

/// @title IdentityRegistry
/// @notice Minimal KYC/approval registry for employee and participant wallets.
contract IdentityRegistry {
    /// @notice Admin address allowed to update statuses.
    address public admin;

    /// @dev Status codes:
    /// 0 = Unverified
    /// 1 = Verified
    /// 2 = Restricted / Terminated
    mapping(address => uint8) private _status;

    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event StatusUpdated(address indexed user, uint8 previousStatus, uint8 newStatus);

    error NotAdmin();

    constructor(address initialAdmin) {
        require(initialAdmin != address(0), "Invalid admin");
        admin = initialAdmin;
        emit AdminChanged(address(0), initialAdmin);
    }

    /// @notice Change the admin.
    /// @param newAdmin The new admin address.
    function setAdmin(address newAdmin) external {
        if (msg.sender != admin) revert NotAdmin();
        require(newAdmin != address(0), "Invalid admin");
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Set the status for a user.
    /// @dev Only callable by admin (your backend / employer operator).
    /// @param user The wallet address.
    /// @param newStatus Status code: 0 = unverified, 1 = verified, 2 = restricted.
    function setStatus(address user, uint8 newStatus) external {
        if (msg.sender != admin) revert NotAdmin();
        require(user != address(0), "Invalid user");
        require(newStatus <= 2, "Invalid status");
        uint8 previous = _status[user];
        _status[user] = newStatus;
        emit StatusUpdated(user, previous, newStatus);
    }

    /// @notice Returns the raw status code for a user.
    function getStatus(address user) external view returns (uint8) {
        return _status[user];
    }

    /// @notice Returns true if the user is verified (status == 1).
    function isVerified(address user) external view returns (bool) {
        return _status[user] == 1;
    }
}
