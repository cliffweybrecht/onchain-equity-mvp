// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITransferPolicy } from "./policy/ITransferPolicy.sol";

contract EquityTokenV2 {
    /// -----------------------------------------------------------------------
    /// Errors (preserve existing semantics)
    /// -----------------------------------------------------------------------
    error TransferNotAllowed();
    error NotAdmin();
    error PolicyZeroAddress();

    /// -----------------------------------------------------------------------
    /// Storage
    /// -----------------------------------------------------------------------
    address public admin;
    ITransferPolicy public transferPolicy;

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    /// -----------------------------------------------------------------------
    /// Events
    /// -----------------------------------------------------------------------
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event TransferPolicyUpdated(address indexed oldPolicy, address indexed newPolicy);

    /// -----------------------------------------------------------------------
    /// Modifiers
    /// -----------------------------------------------------------------------
    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// -----------------------------------------------------------------------
    /// Constructor
    /// -----------------------------------------------------------------------
    constructor(address admin_, address policy_) {
        if (admin_ == address(0)) revert NotAdmin(); // cheap guard; keeps bytecode tiny
        if (policy_ == address(0)) revert PolicyZeroAddress();
        admin = admin_;
        transferPolicy = ITransferPolicy(policy_);
    }

    /// -----------------------------------------------------------------------
    /// Admin
    /// -----------------------------------------------------------------------
    function setTransferPolicy(address newPolicy) external onlyAdmin {
        if (newPolicy == address(0)) revert PolicyZeroAddress();
        emit TransferPolicyUpdated(address(transferPolicy), newPolicy);
        transferPolicy = ITransferPolicy(newPolicy);
    }

    /// -----------------------------------------------------------------------
    /// Core transfer (delegates enforcement to policy)
    /// -----------------------------------------------------------------------
    function transfer(address to, uint256 amount) external returns (bool) {
        if (!transferPolicy.canTransfer(address(this), msg.sender, to, amount)) {
            revert TransferNotAllowed();
        }

        uint256 fromBal = balanceOf[msg.sender];
        require(fromBal >= amount, "InsufficientBalance");

        unchecked {
            balanceOf[msg.sender] = fromBal - amount;
            balanceOf[to] += amount;
        }

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /// -----------------------------------------------------------------------
    /// MVP mint (admin-only). Keep for now; we can harden later.
    /// -----------------------------------------------------------------------
    function mint(address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "To=0");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
