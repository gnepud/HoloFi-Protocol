// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AccessControlManager
/// @author Peng Du
/// @notice Manages centralized role-based access control and KYB approval for the HoloFi protocol.
/// @dev Inherits from OpenZeppelin AccessControl to define roles and administrators.
contract AccessControlManager is AccessControl {
    /// @notice Role identifier for protocol administrators.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Role identifier for oracle price feed updaters.
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    /// @notice Role identifier for KYB verification operators.
    bytes32 public constant KYB_MANAGER_ROLE = keccak256("KYB_MANAGER_ROLE");

    /// @notice Role identifier for pausers.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role identifier for vault card minters.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role identifier for vault card lockers.
    bytes32 public constant LOCKER_ROLE = keccak256("LOCKER_ROLE");

    /// @notice Reverts when the initial admin address is zero.
    error ZeroAddressAdmin();

    /// @notice Reverts when a target KYB account address is zero.
    error ZeroAddressKybAccount();

    /// @notice Reverts when an unauthorized account calls a KYB function.
    /// @param operator The address of the unauthorized caller.
    error UnauthorizedKybOperator(address operator);

    /// @notice Maps an account address to its KYB approval status.
    mapping(address => bool) public isKybApproved;

    /// @notice Emitted when the KYB status of an account changes.
    /// @param account The address of the evaluated account.
    /// @param status The new KYB approval status.
    /// @param operator The authorized caller who made the update.
    event KybStatusUpdated(address indexed account, bool status, address indexed operator);

    modifier onlyKybManagerOrAdmin() {
        if (!hasRole(KYB_MANAGER_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedKybOperator(msg.sender);
        }
        _;
    }

    /// @notice Initializes the access control manager with an initial administrator.
    /// @param initialAdmin The address that receives the default admin and admin roles.
    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) {
            revert ZeroAddressAdmin();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ADMIN_ROLE, initialAdmin);

        _setRoleAdmin(ORACLE_ROLE, ADMIN_ROLE);
        _setRoleAdmin(KYB_MANAGER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(PAUSER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(MINTER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(LOCKER_ROLE, ADMIN_ROLE);
    }

    /// @notice Updates the KYB approval status of a single account.
    /// @param account The address of the account to update.
    /// @param status The new approval status.
    function setKybStatus(address account, bool status) external onlyKybManagerOrAdmin {
        if (account == address(0)) {
            revert ZeroAddressKybAccount();
        }
        isKybApproved[account] = status;
        emit KybStatusUpdated(account, status, msg.sender);
    }

    /// @notice Updates the KYB approval status for multiple accounts in batch.
    /// @param accounts An array of account addresses to update.
    /// @param status The new approval status for all listed accounts.
    function setKybStatusBatch(address[] calldata accounts, bool status) external onlyKybManagerOrAdmin {
        uint256 len = accounts.length;
        for (uint256 i = 0; i < len; i++) {
            address account = accounts[i];
            if (account == address(0)) {
                revert ZeroAddressKybAccount();
            }
            isKybApproved[account] = status;
            emit KybStatusUpdated(account, status, msg.sender);
        }
    }
}
