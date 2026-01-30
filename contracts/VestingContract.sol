// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./EquityToken.sol";
import "./IdentityRegistry.sol";

/// @title VestingContract
/// @notice Stores simple time-based vesting schedules and releases equity tokens to verified employees.
contract VestingContract {
    struct Grant {
        uint256 total;       // total number of units granted
        uint256 released;    // total number of units already released
        uint64 start;        // vesting start timestamp
        uint64 cliff;        // cliff timestamp
        uint64 duration;     // total vesting duration in seconds
        bool exists;         // grant existence flag
    }

    address public admin;
    EquityToken public token;
    IdentityRegistry public identityRegistry;

    mapping(address => Grant) public grants;

    error NotAdmin();
    error GrantAlreadyExists();
    error GrantDoesNotExist();
    error NothingToRelease();
    error NotVerified();

    event GrantCreated(
        address indexed employee,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 duration
    );

    event GrantReleased(address indexed employee, uint256 amountReleased);

    constructor(
        address _admin,
        address _token,
        address _identityRegistry
    ) {
        require(_admin != address(0), "Invalid admin");
        require(_token != address(0), "Invalid token");
        require(_identityRegistry != address(0), "Invalid registry");

        admin = _admin;
        token = EquityToken(_token);
        identityRegistry = IdentityRegistry(_identityRegistry);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice Admin can update the admin address.
    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        admin = newAdmin;
    }

    /// @notice Creates a new vesting grant for an employee.
    function createGrant(
        address employee,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 duration
    ) external onlyAdmin {
        require(employee != address(0), "Invalid employee");
        require(total > 0, "Invalid amount");
        require(duration > 0, "Invalid duration");
        require(cliff >= start, "Cliff before start");

        if (grants[employee].exists) revert GrantAlreadyExists();

        grants[employee] = Grant({
            total: total,
            released: 0,
            start: start,
            cliff: cliff,
            duration: duration,
            exists: true
        });

        emit GrantCreated(employee, total, start, cliff, duration);
    }

    /// @notice Calculates how many units are vested for a given employee.
    function vestedAmount(address employee) public view returns (uint256) {
        Grant memory g = grants[employee];
        if (!g.exists) return 0;

        // Before cliff: nothing vested
        if (block.timestamp < g.cliff) {
            return 0;
        }

        uint256 elapsed = block.timestamp > g.start
            ? block.timestamp - g.start
            : 0;

        if (elapsed >= g.duration) {
            // Fully vested
            return g.total;
        }

        // Linear vesting between start and start + duration
        return (g.total * elapsed) / g.duration;
    }

    /// @notice Releases any vested but unreleased units to the employee.
    /// @dev Mints equity tokens directly to the employee wallet.
    function release(address employee) external {
        Grant storage g = grants[employee];
        if (!g.exists) revert GrantDoesNotExist();

        uint256 vested = vestedAmount(employee);
        uint256 unreleased = vested - g.released;

        if (unreleased == 0) revert NothingToRelease();

        // Employee must be verified in IdentityRegistry
        if (!identityRegistry.isVerified(employee)) {
            revert NotVerified();
        }

        g.released = vested;

        // IMPORTANT:
        // This contract must be set as the admin of EquityToken
        // so that this mint call succeeds.
        token.transfer(employee, unreleased);

        emit GrantReleased(employee, unreleased);
    }
}
