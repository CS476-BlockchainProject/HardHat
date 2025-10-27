// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AccessControlled
 * @notice Drop-in base contract that gives you:
 * - RBAC via {DEFAULT_ADMIN_ROLE}, {PAUSER_ROLE}, {OPERATOR_ROLE}
 * - Pause/unpause controls
 */
abstract contract AccessControlled is AccessControl, Pausable {
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    modifier onlyOperator() {
        _checkRole(OPERATOR_ROLE);
        _;
    }

    modifier whenNotPausedOrAdmin() {
        // let admin bypass pause for break-glass, if desired
        if (!hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) _requireNotPaused();
        _;
    }
}