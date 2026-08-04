# Variable Standardization for `HoloFiVaultCard` Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize state variables, constructor parameters, custom errors, and test fixture variables referencing `HoloFiVaultCard` to `vaultCard` and `ZeroAddressVaultCard`.

**Architecture:** Update `contracts/HoloFiVaultLoanCore.sol` state variable `vaultCard`, constructor parameter `_vaultCard`, and custom error `ZeroAddressVaultCard()`. Update Solidity and TypeScript test suites (`cardCollection` $\rightarrow$ `vaultCard`) and system architecture documentation.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Update `HoloFiVaultLoanCore.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultCard.t.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: `vaultCard` state variable, `_vaultCard` parameter, and `ZeroAddressVaultCard` custom error in `LoanCore`.

- [ ] **Step 1: Update `contracts/HoloFiVaultLoanCore.sol`**

In `contracts/HoloFiVaultLoanCore.sol`:

```solidity
HoloFiVaultCard public immutable vaultCard;

error ZeroAddressVaultCard();

constructor(address _acm, address _vaultCard, address _poolFactory) {
    if (_acm == address(0)) {
        revert ZeroAddressACM();
    }
    if (_vaultCard == address(0)) {
        revert ZeroAddressVaultCard();
    }
    if (_poolFactory == address(0)) {
        revert ZeroAddressPoolFactory();
    }
    acm = AccessControlManager(_acm);
    vaultCard = HoloFiVaultCard(_vaultCard);
    poolFactory = HoloFiLendingPoolFactory(_poolFactory);
}
```

Update `nftCollection` usage to `vaultCard` in `depositCollateral`, `withdrawCollateral`, and `finalizeLiquidation`.

- [ ] **Step 2: Update Solidity Test Suites (`contracts/*.t.sol`)**

Update `cardCollection` variables to `vaultCard` across `HoloFiVaultCard.t.sol`, `HoloFiVaultLoanCore.t.sol`, and `HoloFiDutchAuction.t.sol`. Update `ZeroAddressNFT` error expectations to `ZeroAddressVaultCard`.

- [ ] **Step 3: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (104 total Solidity unit tests).

- [ ] **Step 4: Commit Task 1**

```bash
git add contracts/
git commit -m "feat(HF-37): standardize vaultCard variables in contracts and Solidity tests (relates to HF-37)"
```

---

### Task 2: Update TypeScript Integration Tests & Architecture Documentation

**Files:**
- Modify: `test/HoloFiVaultCard.ts`
- Modify: `test/HoloFiVaultLoanCore.ts`
- Modify: `test/HoloFiDutchAuction.ts`
- Modify: `docs/System Architecture Document.md`

**Interfaces:**
- Produces: Fully standardized TypeScript test suite and system architecture document.

- [ ] **Step 1: Update TypeScript Integration Tests (`test/*.ts`)**

Rename `cardCollection` variables to `vaultCard` in `test/HoloFiVaultCard.ts`, `test/HoloFiVaultLoanCore.ts`, and `test/HoloFiDutchAuction.ts`.

- [ ] **Step 2: Update `docs/System Architecture Document.md`**

Update references from `nftCollection` / `ZeroAddressNFT` to `vaultCard` / `ZeroAddressVaultCard`.

- [ ] **Step 3: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (139 total tests: 104 Solidity + 35 Mocha).

- [ ] **Step 4: Commit Task 2 with Linear Magic Word**

```bash
git add test/ "docs/System Architecture Document.md"
git commit -m "test(HF-37): standardize vaultCard variables in TypeScript integration tests and docs (Fixes HF-37)"
```
