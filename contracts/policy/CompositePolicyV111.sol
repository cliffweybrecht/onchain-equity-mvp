// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Policy interface expected by EquityTokenV2:
/// canTransfer(token, from, to, amount)
interface ITransferPolicyV2 {
    function canTransfer(address token, address from, address to, uint256 amount) external view returns (bool);
    function canTransferTrace(address token, address from, address to, uint256 amount)
        external
        view
        returns (bool ok, uint256 failingIndex, address failingPolicy);
}

/// @notice CompositePolicy v1.1.1 (bugfix): correct 4-arg policy signature for token integration.
/// AND-composes an ordered list of child policies.
/// Adds on-chain "policyStackId" metadata for audit/regulator explainability.
contract CompositePolicyV111 is ITransferPolicyV2 {
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

    function getPolicyStack() external view returns (string memory id, address[] memory stack) {
        return (policyStackId, policies);
    }

    // ---- Core logic ----

    /// @notice AND-composition: fails fast on first failure.
    function canTransfer(address token, address from, address to, uint256 amount)
        external
        view
        override
        returns (bool)
    {
        for (uint256 i = 0; i < policies.length; i++) {
            if (!ITransferPolicyV2(policies[i]).canTransfer(token, from, to, amount)) return false;
        }
        return true;
    }

    /// @notice Trace helper: returns where the stack failed.
    function canTransferTrace(address token, address from, address to, uint256 amount)
        external
        view
        override
        returns (bool ok, uint256 failingIndex, address failingPolicy)
    {
        for (uint256 i = 0; i < policies.length; i++) {
            if (!ITransferPolicyV2(policies[i]).canTransfer(token, from, to, amount)) {
                return (false, i, policies[i]);
            }
        }
        return (true, type(uint256).max, address(0));
    }

    // ---- Optional management ----

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

        uint256 last = policies.length - 1;
        if (index != last) {
            policies[index] = policies[last];
        }
        policies.pop();

        emit PolicyRemoved(index, old);
    }
}
