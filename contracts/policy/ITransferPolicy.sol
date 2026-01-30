// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITransferPolicy {
    /**
     * @dev MUST return true if transfer is allowed, false otherwise.
     * Token will revert with TransferNotAllowed() when false.
     *
     * Keep it boolean for regulator-explainable behavior:
     * “Policy says yes/no.” Detailed reasons can be added later via
     * separate view methods/events without changing token semantics.
     */
    function canTransfer(
        address token,
        address from,
        address to,
        uint256 amount
    ) external view returns (bool);
}
