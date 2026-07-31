# AccessControlManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and thoroughly test `AccessControlManager.sol` smart contract managing core protocol roles (`ADMIN_ROLE`, `ORACLE_ROLE`, `KYB_MANAGER_ROLE`, `PAUSER_ROLE`) on top of OpenZeppelin `AccessControl`.

**Architecture:** Solidity contract `AccessControlManager.sol` extending OpenZeppelin `AccessControl`. Unit-tested in EVM via `contracts/AccessControlManager.t.sol` (Solidity + forge-std) and TypeScript integration tested via `test/AccessControlManager.ts` (Hardhat 3 + Ethers v6 + Mocha + Chai).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task
- Do not remove or weaken any existing test assertions

---

### Task 1: Implement `AccessControlManager.sol` Contract and Solidity Unit Tests

**Files:**
- Create: `contracts/AccessControlManager.sol`
- Create: `contracts/AccessControlManager.t.sol`

**Interfaces:**
- Produces: `AccessControlManager` contract exposing role constants (`ADMIN_ROLE`, `ORACLE_ROLE`, `KYB_MANAGER_ROLE`, `PAUSER_ROLE`) and custom error `ZeroAddressAdmin()`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/AccessControlManager.t.sol`)**

```solidity
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

    function setUp() public {
        acm = new AccessControlManager(admin);
    }

    function test_Constructor_InitialRoles() public view {
        assertTrue(acm.hasRole(acm.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(acm.hasRole(acm.ADMIN_ROLE(), admin));
    }

    function test_RevertIf_ZeroAddressAdmin() public {
        vm.expectRevert(AccessControlManager.ZeroAddressAdmin.selector);
        new AccessControlManager(address(0));
    }

    function test_AdminRoleHierarchy() public view {
        assertEq(acm.getRoleAdmin(acm.ADMIN_ROLE()), acm.ADMIN_ROLE());
        assertEq(acm.getRoleAdmin(acm.ORACLE_ROLE()), acm.ADMIN_ROLE());
        assertEq(acm.getRoleAdmin(acm.KYB_MANAGER_ROLE()), acm.ADMIN_ROLE());
        assertEq(acm.getRoleAdmin(acm.PAUSER_ROLE()), acm.ADMIN_ROLE());
    }

    function test_GrantAndRevokeRolesByAdmin() public {
        vm.startPrank(admin);

        acm.grantRole(acm.ORACLE_ROLE(), oracle);
        assertTrue(acm.hasRole(acm.ORACLE_ROLE(), oracle));

        acm.grantRole(acm.KYB_MANAGER_ROLE(), kybManager);
        assertTrue(acm.hasRole(acm.KYB_MANAGER_ROLE(), kybManager));

        acm.grantRole(acm.PAUSER_ROLE(), pauser);
        assertTrue(acm.hasRole(acm.PAUSER_ROLE(), pauser));

        acm.revokeRole(acm.ORACLE_ROLE(), oracle);
        assertFalse(acm.hasRole(acm.ORACLE_ROLE(), oracle));

        vm.stopPrank();
    }

    function test_RevertIf_UnauthorizedGrant() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                acm.ADMIN_ROLE()
            )
        );
        acm.grantRole(acm.ORACLE_ROLE(), oracle);
    }

    function test_RenounceRole() public {
        vm.prank(admin);
        acm.grantRole(acm.ORACLE_ROLE(), oracle);

        vm.prank(oracle);
        acm.renounceRole(acm.ORACLE_ROLE(), oracle);
        assertFalse(acm.hasRole(acm.ORACLE_ROLE(), oracle));
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `AccessControlManager.sol`.

- [ ] **Step 3: Implement `AccessControlManager.sol`**

```solidity
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

    error ZeroAddressAdmin();

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
    }
}
```

- [ ] **Step 4: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS with 6 passing tests.

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/AccessControlManager.sol contracts/AccessControlManager.t.sol
git commit -m "feat(HF-10): implement AccessControlManager contract and Solidity tests"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/AccessControlManager.ts`)

**Files:**
- Create: `test/AccessControlManager.ts`

**Interfaces:**
- Consumes: `AccessControlManager` contract from `contracts/AccessControlManager.sol`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/AccessControlManager.ts`)**

```ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("AccessControlManager Integration Tests", function () {
  async function deployAcmFixture() {
    const [owner, admin, oracle, kybManager, pauser, user] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    return { acm, owner, admin, oracle, kybManager, pauser, user };
  }

  it("Should set up initial roles correctly", async function () {
    const { acm, admin } = await networkHelpers.loadFixture(deployAcmFixture);
    const defaultAdminRole = await acm.DEFAULT_ADMIN_ROLE();
    const adminRole = await acm.ADMIN_ROLE();

    expect(await acm.hasRole(defaultAdminRole, admin.address)).to.be.true;
    expect(await acm.hasRole(adminRole, admin.address)).to.be.true;
  });

  it("Should revert if deployed with zero address admin", async function () {
    await expect(
      ethers.deployContract("AccessControlManager", [ethers.ZeroAddress])
    ).to.be.revertedWithCustomError(
      await ethers.getContractFactory("AccessControlManager"),
      "ZeroAddressAdmin"
    );
  });

  it("Should allow admin to grant and revoke roles and emit events", async function () {
    const { acm, admin, oracle } = await networkHelpers.loadFixture(deployAcmFixture);
    const oracleRole = await acm.ORACLE_ROLE();

    await expect(acm.connect(admin).grantRole(oracleRole, oracle.address))
      .to.emit(acm, "RoleGranted")
      .withArgs(oracleRole, oracle.address, admin.address);

    expect(await acm.hasRole(oracleRole, oracle.address)).to.be.true;

    await expect(acm.connect(admin).revokeRole(oracleRole, oracle.address))
      .to.emit(acm, "RoleRevoked")
      .withArgs(oracleRole, oracle.address, admin.address);

    expect(await acm.hasRole(oracleRole, oracle.address)).to.be.false;
  });

  it("Should revert when non-admin attempts to grant roles", async function () {
    const { acm, user, oracle } = await networkHelpers.loadFixture(deployAcmFixture);
    const oracleRole = await acm.ORACLE_ROLE();
    const adminRole = await acm.ADMIN_ROLE();

    await expect(acm.connect(user).grantRole(oracleRole, oracle.address))
      .to.be.revertedWithCustomError(acm, "AccessControlUnauthorizedAccount")
      .withArgs(user.address, adminRole);
  });
});
```

- [ ] **Step 2: Run build, typecheck, and test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS with 10 passing tests (6 Solidity + 4 Mocha).

- [ ] **Step 3: Commit Task 2**

```bash
git add test/AccessControlManager.ts
git commit -m "test(HF-10): add TypeScript integration tests for AccessControlManager"
```
