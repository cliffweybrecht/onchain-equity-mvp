// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITransferPolicy } from "./ITransferPolicy.sol";

/// @notice CompositePolicy (AND): allows a transfer only if ALL child policies allow.
/// @dev Enterprise-configurable, auditable, regulator-explainable.
///      Token stays stable; compliance rules become a composable policy stack.
contract CompositePolicy is ITransferPolicy {
    // ---- Admin (simple owner-style) ----
    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "NotAdmin");
        _;
    }

    // ---- Policy stack ----
    address[] private _policies;

    // ---- Events (auditability) ----
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    event PolicyAdded(address indexed policy, uint256 indexed index);
    event PolicyInserted(address indexed policy, uint256 indexed index);
    event PolicyRemoved(address indexed policy, uint256 indexed index);

    event PolicyMoved(uint256 indexed fromIndex, uint256 indexed toIndex, address indexed policy);
    event PolicyReplaced(uint256 indexed index, address indexed oldPolicy, address indexed newPolicy);

    constructor(address _admin, address[] memory initialPolicies) {
        require(_admin != address(0), "ZeroAdmin");
        admin = _admin;

        // Empty stack is allowed (AND over empty set => true).
        for (uint256 i = 0; i < initialPolicies.length; i++) {
            _requirePolicy(initialPolicies[i]);
            _policies.push(initialPolicies[i]);
            emit PolicyAdded(initialPolicies[i], i);
        }
    }

    // -----------------------------
    // ITransferPolicy (token-aware)
    // -----------------------------
    /// @notice AND logic over child policies.
    /// If any child policy returns false, this returns false.
    function canTransfer(
        address token,
        address from,
        address to,
        uint256 amount
    ) external view override returns (bool) {
        uint256 n = _policies.length;
        for (uint256 i = 0; i < n; i++) {
            if (!ITransferPolicy(_policies[i]).canTransfer(token, from, to, amount)) {
                return false;
            }
        }
        return true;
    }

    // -----------------------------
    // View helpers (auditable)
    // -----------------------------
    function policyCount() external view returns (uint256) {
        return _policies.length;
    }

    function policyAt(uint256 index) external view returns (address) {
        require(index < _policies.length, "IndexOOB");
        return _policies[index];
    }

    function getPolicies() external view returns (address[] memory) {
        return _policies;
    }

    /// @notice Regulator-explainable trace: returns (allowed, firstFailureIndex, firstFailurePolicy).
    /// If allowed == true, failureIndex == type(uint256).max and failurePolicy == address(0).
    function canTransferTrace(
        address token,
        address from,
        address to,
        uint256 amount
    ) external view returns (bool allowed, uint256 failureIndex, address failurePolicy) {
        uint256 n = _policies.length;
        for (uint256 i = 0; i < n; i++) {
            address p = _policies[i];
            if (!ITransferPolicy(p).canTransfer(token, from, to, amount)) {
                return (false, i, p);
            }
        }
        return (true, type(uint256).max, address(0));
    }

    // -----------------------------
    // Admin operations (configurable)
    // -----------------------------
    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "ZeroAdmin");
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function addPolicy(address policy) external onlyAdmin {
        _requirePolicy(policy);
        _policies.push(policy);
        emit PolicyAdded(policy, _policies.length - 1);
    }

    function insertPolicy(uint256 index, address policy) external onlyAdmin {
        _requirePolicy(policy);
        require(index <= _policies.length, "IndexOOB");

        _policies.push(address(0)); // expand
        for (uint256 i = _policies.length - 1; i > index; i--) {
            _policies[i] = _policies[i - 1];
        }
        _policies[index] = policy;

        emit PolicyInserted(policy, index);
    }

    function removePolicy(uint256 index) external onlyAdmin {
        require(index < _policies.length, "IndexOOB");
        address removed = _policies[index];

        uint256 last = _policies.length - 1;
        for (uint256 i = index; i < last; i++) {
            _policies[i] = _policies[i + 1];
        }
        _policies.pop();

        emit PolicyRemoved(removed, index);
    }

    /// @notice Move a policy from one index to another (reorder stack).
    function movePolicy(uint256 fromIndex, uint256 toIndex) external onlyAdmin {
        require(fromIndex < _policies.length, "FromOOB");
        require(toIndex < _policies.length, "ToOOB");
        if (fromIndex == toIndex) return;

        address p = _policies[fromIndex];

        if (fromIndex < toIndex) {
            // shift left between (fromIndex+1 .. toIndex)
            for (uint256 i = fromIndex; i < toIndex; i++) {
                _policies[i] = _policies[i + 1];
            }
            _policies[toIndex] = p;
        } else {
            // shift right between (toIndex .. fromIndex-1)
            for (uint256 i = fromIndex; i > toIndex; i--) {
                _policies[i] = _policies[i - 1];
            }
            _policies[toIndex] = p;
        }

        emit PolicyMoved(fromIndex, toIndex, p);
    }

    function replacePolicy(uint256 index, address newPolicy) external onlyAdmin {
        _requirePolicy(newPolicy);
        require(index < _policies.length, "IndexOOB");

        address old = _policies[index];
        _policies[index] = newPolicy;

        emit PolicyReplaced(index, old, newPolicy);
    }

    // -----------------------------
    // Internal helpers
    // -----------------------------
    function _requirePolicy(address policy) internal view {
        require(policy != address(0), "ZeroPolicy");

        uint256 size;
        assembly {
            size := extcodesize(policy)
        }
        require(size > 0, "PolicyNotContract");
    }
}
