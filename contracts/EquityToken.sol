// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./IdentityRegistry.sol";

/// @title EquityToken
/// @notice Basic restricted-transfer security token for employee equity.
contract EquityToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals = 0; // Equity is usually whole units

    uint256 public totalSupply;

    address public admin;
    IdentityRegistry public identityRegistry;

    mapping(address => uint256) private _balances;

    error NotAdmin();
    error TransferNotAllowed();
    error InvalidAddress();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);

    constructor(
        string memory _name,
        string memory _symbol,
        address _identityRegistry,
        address _admin
    ) {
        require(_identityRegistry != address(0), "Invalid registry");
        require(_admin != address(0), "Invalid admin");

        name = _name;
        symbol = _symbol;
        identityRegistry = IdentityRegistry(_identityRegistry);
        admin = _admin;

        emit AdminChanged(address(0), _admin);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice Change admin address.
    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Mint new shares to an employee (or DAO, treasury, etc).
    function mint(address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "Invalid address");

        // Must be a verified user
        if (!identityRegistry.isVerified(to)) {
            revert TransferNotAllowed();
        }

        totalSupply += amount;
        _balances[to] += amount;
        emit Mint(to, amount);
        emit Transfer(address(0), to, amount);
    }

    /// @notice Burn shares from an address (e.g., cancellations, forfeitures).
    function burn(address from, uint256 amount) external onlyAdmin {
        require(from != address(0), "Invalid address");
        require(_balances[from] >= amount, "Insufficient balance");

        _balances[from] -= amount;
        totalSupply -= amount;
        emit Burn(from, amount);
        emit Transfer(from, address(0), amount);
    }

    /// @notice Restricted transfer. Both sender & receiver must be verified.
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "Invalid address");
        require(_balances[msg.sender] >= amount, "Insufficient balance");

        // Check identity registry for both sender and receiver
        if (
            !identityRegistry.isVerified(msg.sender) ||
            !identityRegistry.isVerified(to)
        ) {
            revert TransferNotAllowed();
        }

        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);

        return true;
    }

    /// @notice Read balance of a user.
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }
}
