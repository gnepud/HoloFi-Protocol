# Vault Lifecycle State Simplification (`HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify `VaultStatus` in `HoloFiVaultLoanCore.sol` by removing the redundant `Liquidated` state and enforcing a clean 3-state enum `{ Active, Liquidating, Closed }` with `VaultStatus.Closed` as the single terminal state for all settled vaults.

**Architecture:** Update `HoloFiVaultLoanCore.sol` enum definition to `enum VaultStatus { Active, Liquidating, Closed }`. Update `finalizeLiquidation` to transition vault status to `VaultStatus.Closed`. Update all unit and integration test assertions to verify `vault.status == VaultStatus.Closed`.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Simplify `VaultStatus` Enum & Update Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: 3-state `VaultStatus` enum (`{ Active, Liquidating, Closed }`) and `VaultStatus.Closed` transition in `finalizeLiquidation`.

- [ ] **Step 1: Update `contracts/HoloFiDutchAuction.t.sol` assertions**

Update test assertions in `contracts/HoloFiDutchAuction.t.sol` from `VaultStatus.Liquidated` to `VaultStatus.Closed`:

```solidity
assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Closed));
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to `VaultStatus.Closed` mismatch with `VaultStatus.Liquidated`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol`**

In `contracts/HoloFiVaultLoanCore.sol`:

```solidity
enum VaultStatus { Active, Liquidating, Closed }

function finalizeLiquidation(uint256 vaultId, address liquidator) external {
    if (msg.sender != dutchAuction) {
        revert UnauthorizedAuction(msg.sender);
    }
    CollateralVault storage vault = vaults[vaultId];
    if (vault.status != VaultStatus.Liquidating) {
        revert VaultNotLiquidating(vaultId);
    }

    vault.principalDebt = 0;
    vault.accumulatedInterest = 0;
    vault.status = VaultStatus.Closed;

    uint256 len = vault.tokenIds.length;
    for (uint256 i = 0; i < len; i++) {
        uint256 tokenId = vault.tokenIds[i];
        nftVaultId[tokenId] = 0;
        nftCollection.setCardLock(tokenId, false);
        nftCollection.safeTransferFrom(address(this), liquidator, tokenId);
    }

    delete vault.tokenIds;

    emit VaultLiquidated(vaultId, liquidator);
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (104 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiDutchAuction.t.sol
git commit -m "feat(HF-36): simplify VaultStatus enum to 3-state lifecycle (relates to HF-36)"
```

---

### Task 2: Update TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)

**Files:**
- Modify: `test/HoloFiDutchAuction.ts`

**Interfaces:**
- Consumes: `VaultStatus.Closed` (`2n`).

- [ ] **Step 1: Update TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)**

In `test/HoloFiDutchAuction.ts`, update status assertions from `3n` (`Liquidated`) to `2n` (`Closed`):

```ts
expect(vaultInfo.status).to.equal(2n); // VaultStatus.Closed
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (139 total tests: 104 Solidity + 35 Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiDutchAuction.ts
git commit -m "test(HF-36): update TypeScript integration tests for VaultStatus.Closed finality (Fixes HF-36)"
```
