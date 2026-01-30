// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITransferPolicy {
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);
}

/// @notice CompositePolicy v1.1
/// AND-composes an ordered list of child policies.
/// Adds on-chain, human-readable "policy package" metadata for audit/regulator explainability.
contract CompositePolicyV11 is ITransferPolicy {
    address public admin;

    // Ordered stack of child policies (AND).
    address[] public policies;

    // Human-readable policy package id (e.g., "BASESEP-84532-STACK-2026-01-28-v1")
    string public policyStackId;

    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event PolicyAdded(uint256 indexed index, address indexed policy);
    event PolicyReplaced(uint256 indexed index, address indexed oldPolicy, address indexed newPolicy);
    event PolicyRemoved(uint256 indexed index, address indexed oldPolicy);

    event PolicyStackIdUpdated(string oldId, string newId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NotAdmin");
        _;
    }

    constructor(address _admin, string memory _policyStackId, address[] memory _policies) {
        require(_admin != address(0), "BadAdmin");
        admin = _admin;
        policyStackId = _policyStackId;

        for (uint256 i = 0; i < _policies.length; i++) {
            require(_policies[i] != address(0), "BadPolicy");
            policies.push(_policies[i]);
            emit PolicyAdded(i, _policies[i]);
        }
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "BadAdmin");
        emit AdminUpdated(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Admin-only setter for human-readable stack/package metadata.
    function setPolicyStackId(string calldata newId) external onlyAdmin {
        string memory old = policyStackId;
        policyStackId = newId;
        emit PolicyStackIdUpdated(old, newId);
    }

    function policyCount() external view returns (uint256) {
        return policies.length;
    }

    function getPolicy(uint256 index) external view returns (address) {
        return policies[index];
    }

    /// @notice Optional helper for auditors / UIs.
    function getPolicyStack() external view returns (string memory id, address[] memory stack) {
        return (policyStackId, policies);
    }

    /// @notice AND-composition: fails fast on first failure.
    function canTransfer(address from, address to, uint256 amount) external view override returns (bool) {
        for (uint256 i = 0; i < policies.length; i++) {
            if (!ITransferPolicy(policies[i]).canTransfer(from, to, amount)) return false;
        }
        return true;
    }

    // --- Optional management fns (keep parity with your current CompositePolicy if you had these) ---

    function addPolicy(address policy) external onlyAdmin {
        require(policy != address(0), "BadPolicy");
        policies.push(policy);
        emit PolicyAdded(policies.length - 1, policy);
    }

    function replacePolicy(uint256 index, address newPolicy) external onlyAdmin {
        require(index < policies.length, "BadIndex");
        require(newPolicy != address(0), "BadPolicy");
        address old = policies[index];
        policies[index] = newPolicy;
        emit PolicyReplaced(index, old, newPolicy);
    }

    function removePolicy(uint256 index) external onlyAdmin {
        require(index < policies.length, "BadIndex");
        address old = policies[index];

        // swap-remove
        uint256 last = policies.length - 1;
        if (index != last) {
            policies[index] = policies[last];
        }
        policies.pop();

        emit PolicyRemoved(index, old);
    }
}
