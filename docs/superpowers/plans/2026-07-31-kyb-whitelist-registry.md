# KYB Whitelist Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and test on-chain KYB whitelist tracking in `AccessControlManager.sol` with single/batch approval functions and role permissions.

**Architecture:** Extend `AccessControlManager.sol` with `mapping(address => bool) public isKybApproved`, `setKybStatus`, `setKybStatusBatch`, `KybStatusUpdated` event, and custom errors `ZeroAddressKybAccount` & `UnauthorizedKybOperator`. Tested via Solidity unit tests (`contracts/AccessControlManager.t.sol`) and TypeScript integration tests (`test/AccessControlManager.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Extend `AccessControlManager.sol` & Update Solidity Unit Tests

**Files:**
- Modify: `contracts/AccessControlManager.sol`
- Modify: `contracts/AccessControlManager.t.sol`

**Interfaces:**
- Produces: `isKybApproved(address account) -> bool`, `setKybStatus(address account, bool status)`, `setKybStatusBatch(address[] calldata accounts, bool status)`, `event KybStatusUpdated(address indexed account, bool status, address indexed operator)`.

- [ ] **Step 1: Update Solidity Unit Tests (`contracts/AccessControlManager.t.sol`)**

Add test functions to `contracts/AccessControlManager.t.sol`:

```solidity
    event KybStatusUpdated(address indexed account, bool status, address indexed operator);

    function test_SetKybStatus_Success() public {
        vm.prank(admin);
        acm.grantRole(acm.KYB_MANAGER_ROLE(), kybManager);

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
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing KYB functions in `AccessControlManager.sol`.

- [ ] **Step 3: Update `AccessControlManager.sol` Implementation**

Add to `contracts/AccessControlManager.sol`:

```solidity
    mapping(address => bool) public isKybApproved;

    event KybStatusUpdated(address indexed account, bool status, address indexed operator);

    error ZeroAddressKybAccount();
    error UnauthorizedKybOperator(address operator);

    modifier onlyKybManagerOrAdmin() {
        if (!hasRole(KYB_MANAGER_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedKybOperator(msg.sender);
        }
        _;
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
```

- [ ] **Step 4: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS with 11 passing tests.

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/AccessControlManager.sol contracts/AccessControlManager.t.sol
git commit -m "feat(HF-11): add KYB whitelist registry to AccessControlManager and Solidity tests"
```

---

### Task 2: Extend TypeScript Integration Tests (`test/AccessControlManager.ts`)

**Files:**
- Modify: `test/AccessControlManager.ts`

**Interfaces:**
- Consumes: `setKybStatus`, `setKybStatusBatch`, `isKybApproved`, `KybStatusUpdated` from `AccessControlManager`.

- [ ] **Step 1: Add Integration Tests to `test/AccessControlManager.ts`**

Add tests to `test/AccessControlManager.ts`:

```ts
  it("Should allow KYB manager or admin to update KYB status and emit event", async function () {
    const { acm, admin, kybManager, user } = await networkHelpers.loadFixture(deployAcmFixture);
    const kybRole = await acm.KYB_MANAGER_ROLE();
    await acm.connect(admin).grantRole(kybRole, kybManager.address);

    await expect(acm.connect(kybManager).setKybStatus(user.address, true))
      .to.emit(acm, "KybStatusUpdated")
      .withArgs(user.address, true, kybManager.address);

    expect(await acm.isKybApproved(user.address)).to.be.true;
  });

  it("Should allow batch KYB status updates", async function () {
    const { acm, admin, user, oracle } = await networkHelpers.loadFixture(deployAcmFixture);

    await acm.connect(admin).setKybStatusBatch([user.address, oracle.address], true);

    expect(await acm.isKybApproved(user.address)).to.be.true;
    expect(await acm.isKybApproved(oracle.address)).to.be.true;
  });

  it("Should revert when unauthorized user attempts to set KYB status", async function () {
    const { acm, user, oracle } = await networkHelpers.loadFixture(deployAcmFixture);

    await expect(acm.connect(user).setKybStatus(oracle.address, true))
      .to.be.revertedWithCustomError(acm, "UnauthorizedKybOperator")
      .withArgs(user.address);
  });

  it("Should revert when setting KYB status for zero address", async function () {
    const { acm, admin } = await networkHelpers.loadFixture(deployAcmFixture);

    await expect(
      acm.connect(admin).setKybStatus(ethers.ZeroAddress, true)
    ).to.be.revertedWithCustomError(acm, "ZeroAddressKybAccount");
  });
```

- [ ] **Step 2: Run build, typecheck, and test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS with 15 passing tests (11 Solidity + 4 TypeScript).

- [ ] **Step 3: Commit Task 2**

```bash
git add test/AccessControlManager.ts
git commit -m "test(HF-11): add TypeScript integration tests for KYB whitelist registry (Fixes HF-11)"
```
