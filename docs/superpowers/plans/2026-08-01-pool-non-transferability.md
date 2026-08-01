# ERC-4626 Share Token Non-Transferability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce non-transferability of `HoloFiLendingPool` `pToken` share tokens by overriding OpenZeppelin v5 `_update` hook to block secondary market transfers.

**Architecture:** Override `_update(address from, address to, uint256 value)` in `HoloFiLendingPool.sol` to revert with custom error `ShareTokenNonTransferable()` when `from != address(0)` and `to != address(0)`. Minting (on deposit) and burning (on redeem) proceed normally. Tested via Solidity unit tests (`contracts/HoloFiLendingPool.t.sol`) and TypeScript integration tests (`test/HoloFiLendingPool.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Share Token Non-Transferability in `HoloFiLendingPool.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiLendingPool.sol`
- Modify: `contracts/HoloFiLendingPool.t.sol`

**Interfaces:**
- Produces: `error ShareTokenNonTransferable()`, overridden `_update(address from, address to, uint256 value)` hook.

- [ ] **Step 1: Write Solidity Unit Test Cases (`contracts/HoloFiLendingPool.t.sol`)**

Add unit tests to `contracts/HoloFiLendingPool.t.sol`:

```solidity
    function test_RevertIf_TransferShareToken() public {
        vm.prank(lp);
        uint256 shares = poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ShareTokenNonTransferable.selector));
        poolEurc.transfer(user, shares);
    }

    function test_RevertIf_TransferFromShareToken() public {
        vm.prank(lp);
        uint256 shares = poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(lp);
        poolEurc.approve(user, shares);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ShareTokenNonTransferable.selector));
        poolEurc.transferFrom(lp, user, shares);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `ShareTokenNonTransferable` error in `HoloFiLendingPool.sol`.

- [ ] **Step 3: Update `contracts/HoloFiLendingPool.sol` Implementation**

Add to `contracts/HoloFiLendingPool.sol`:

```solidity
    error ShareTokenNonTransferable();

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (from != address(0) && to != address(0)) {
            revert ShareTokenNonTransferable();
        }
        super._update(from, to, value);
    }
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (47 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiLendingPool.sol contracts/HoloFiLendingPool.t.sol
git commit -m "feat(HF-16): implement ERC-4626 share token non-transferability and Solidity tests (relates to HF-16)"
```

---

### Task 2: Extend TypeScript Integration Tests (`test/HoloFiLendingPool.ts`)

**Files:**
- Modify: `test/HoloFiLendingPool.ts`

**Interfaces:**
- Consumes: `transfer`, `transferFrom`, `ShareTokenNonTransferable`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiLendingPool.ts`)**

Add integration tests to `test/HoloFiLendingPool.ts`:

```ts
  it("Should revert transfer or transferFrom of share tokens with custom error ShareTokenNonTransferable", async function () {
    const { poolEurc, lp, unauthorized } = await networkHelpers.loadFixture(deployLendingPoolFixture);
    const depositAmount = ethers.parseUnits("1000", 6);

    await poolEurc.connect(lp).deposit(depositAmount, lp.address);
    const shares = await poolEurc.balanceOf(lp.address);

    await expect(
      poolEurc.connect(lp).transfer(unauthorized.address, shares)
    ).to.be.revertedWithCustomError(poolEurc, "ShareTokenNonTransferable");

    await poolEurc.connect(lp).approve(unauthorized.address, shares);

    await expect(
      poolEurc.connect(unauthorized).transferFrom(lp.address, unauthorized.address, shares)
    ).to.be.revertedWithCustomError(poolEurc, "ShareTokenNonTransferable");
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (68 total tests: 47 Solidity + 21 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiLendingPool.ts
git commit -m "test(HF-16): add TypeScript integration tests for ERC-4626 share token non-transferability (Fixes HF-16)"
```
