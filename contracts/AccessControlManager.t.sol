// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

contract AccessControlManagerTest is Test {
    AccessControlManager public acm;
    address public admin = address(0x1111);
    address public oracle = address(0x2222);
    address public kybManager = address(0x3333);
    address public pauser = address(0x4444);
    address public alice = address(0x5555);

    bytes32 public adminRole;
    bytes32 public oracleRole;
    bytes32 public kybManagerRole;
    bytes32 public pauserRole;

    function setUp() public {
        acm = new AccessControlManager(admin);
        adminRole = acm.ADMIN_ROLE();
        oracleRole = acm.ORACLE_ROLE();
        kybManagerRole = acm.KYB_MANAGER_ROLE();
        pauserRole = acm.PAUSER_ROLE();
    }

    function test_Constructor_InitialRoles() public view {
        assertTrue(acm.hasRole(acm.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(acm.hasRole(adminRole, admin));
    }

    function test_RevertIf_ZeroAddressAdmin() public {
        vm.expectRevert(AccessControlManager.ZeroAddressAdmin.selector);
        new AccessControlManager(address(0));
    }

    function test_AdminRoleHierarchy() public view {
        assertEq(acm.getRoleAdmin(adminRole), adminRole);
        assertEq(acm.getRoleAdmin(oracleRole), adminRole);
        assertEq(acm.getRoleAdmin(kybManagerRole), adminRole);
        assertEq(acm.getRoleAdmin(pauserRole), adminRole);
    }

    function test_MinterRoleHierarchy() public view {
        assertEq(acm.getRoleAdmin(acm.MINTER_ROLE()), acm.ADMIN_ROLE());
    }

    function test_GrantAndRevokeRolesByAdmin() public {
        vm.startPrank(admin);

        acm.grantRole(oracleRole, oracle);
        assertTrue(acm.hasRole(oracleRole, oracle));

        acm.grantRole(kybManagerRole, kybManager);
        assertTrue(acm.hasRole(kybManagerRole, kybManager));

        acm.grantRole(pauserRole, pauser);
        assertTrue(acm.hasRole(pauserRole, pauser));

        acm.revokeRole(oracleRole, oracle);
        assertFalse(acm.hasRole(oracleRole, oracle));

        vm.stopPrank();
    }

    function test_RevertIf_UnauthorizedGrant() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                adminRole
            )
        );
        vm.prank(alice);
        acm.grantRole(oracleRole, oracle);
    }

    function test_RenounceRole() public {
        vm.prank(admin);
        acm.grantRole(oracleRole, oracle);

        vm.prank(oracle);
        acm.renounceRole(oracleRole, oracle);
        assertFalse(acm.hasRole(oracleRole, oracle));
    }

    event KybStatusUpdated(address indexed account, bool status, address indexed operator);

    function test_SetKybStatus_Success() public {
        vm.prank(admin);
        acm.grantRole(kybManagerRole, kybManager);

        vm.startPrank(kybManager);
        vm.expectEmit(true, true, true, true);
        emit KybStatusUpdated(alice, true, kybManager);
        acm.setKybStatus(alice, true);
        vm.stopPrank();

        assertTrue(acm.isKybApproved(alice));
    }

    function test_SetKybStatus_AdminSuccess() public {
        vm.prank(admin);
        acm.setKybStatus(alice, true);
        assertTrue(acm.isKybApproved(alice));
    }

    function test_SetKybStatusBatch_Success() public {
        address[] memory accounts = new address[](2);
        accounts[0] = address(0x6666);
        accounts[1] = address(0x7777);

        vm.prank(admin);
        acm.setKybStatusBatch(accounts, true);

        assertTrue(acm.isKybApproved(accounts[0]));
        assertTrue(acm.isKybApproved(accounts[1]));
    }

    function test_RevertIf_ZeroAddressKybAccount() public {
        vm.prank(admin);
        vm.expectRevert(AccessControlManager.ZeroAddressKybAccount.selector);
        acm.setKybStatus(address(0), true);
    }

    function test_RevertIf_UnauthorizedKybManager() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                AccessControlManager.UnauthorizedKybOperator.selector,
                alice
            )
        );
        acm.setKybStatus(oracle, true);
    }
}
