// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AccessControlManager
 * @notice Centralized Role-Based Access Control manager for HoloFi protocol.
 */
contract AccessControlManager is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant KYB_MANAGER_ROLE = keccak256("KYB_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error ZeroAddressAdmin();
    error ZeroAddressKybAccount();
    error UnauthorizedKybOperator(address operator);

    mapping(address => bool) public isKybApproved;

    event KybStatusUpdated(address indexed account, bool status, address indexed operator);

    modifier onlyKybManagerOrAdmin() {
        if (!hasRole(KYB_MANAGER_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedKybOperator(msg.sender);
        }
        _;
    }

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) {
            revert ZeroAddressAdmin();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ADMIN_ROLE, initialAdmin);

        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, ADMIN_ROLE);
        _setRoleAdmin(KYB_MANAGER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(PAUSER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(MINTER_ROLE, ADMIN_ROLE);
    }

    function setKybStatus(address account, bool status) external onlyKybManagerOrAdmin {
        if (account == address(0)) {
            revert ZeroAddressKybAccount();
        }
        isKybApproved[account] = status;
        emit KybStatusUpdated(account, status, msg.sender);
    }

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
