// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITransferPolicy } from "./ITransferPolicy.sol";

interface IIdentityRegistry {
    function isVerified(address user) external view returns (bool);
}

/**
 * @notice v1 policy: allow transfer iff recipient is verified in IdentityRegistry.
 * Optional: also require sender verified (toggleable).
 *
 * This mirrors Part 3.5 findings:
 * - recipient unverified => TransferNotAllowed()
 * - verified recipients succeed
 */
contract ComplianceGatedPolicyV1 is ITransferPolicy {
    IIdentityRegistry public immutable registry;

    // Enterprise-configurable toggles (v1)
    bool public requireSenderVerified;

    address public admin;

    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event RequireSenderVerifiedUpdated(bool oldValue, bool newValue);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NotAdmin");
        _;
    }

    constructor(address registry_, address admin_, bool requireSenderVerified_) {
        require(registry_ != address(0), "Registry=0");
        require(admin_ != address(0), "Admin=0");
        registry = IIdentityRegistry(registry_);
        admin = admin_;
        requireSenderVerified = requireSenderVerified_;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Admin=0");
        emit AdminUpdated(admin, newAdmin);
        admin = newAdmin;
    }

    function setRequireSenderVerified(bool v) external onlyAdmin {
        emit RequireSenderVerifiedUpdated(requireSenderVerified, v);
        requireSenderVerified = v;
    }

    function canTransfer(
        address /*token*/,
        address from,
        address to,
        uint256 /*amount*/
    ) external view returns (bool) {
        // Always block burning-to-zero unless you explicitly want it later
        if (to == address(0)) return false;

        // Require recipient verified (core compliance gate)
        if (!registry.isVerified(to)) return false;

        // Optional: require sender verified too (enterprise toggle)
        if (requireSenderVerified && !registry.isVerified(from)) return false;

        return true;
    }
}
