# Pool-Level Risk Parameters & Per-Vault Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `HoloFiLendingPool`, `HoloFiLendingPoolFactory`, `HoloFiVaultLoanCore`, and `HoloFiDutchAuction` to move credit risk parameters (`maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`) to `HoloFiLendingPool` and bind each vault to its specific `lendingPool` during `createVault(address lendingPool)`.

**Architecture:** Transfer risk parameters and calculations from `HoloFiVaultLoanCore` to `HoloFiLendingPool`. Update `HoloFiLendingPoolFactory.createPool` to initialize custom risk configurations. Bind `lendingPool` in `CollateralVault` on `createVault(lendingPool)`. Simplify `borrow(vaultId, amount)` and `repay(vaultId, amount)`. Update Dutch Auction liquidation settlement and update all tests, deployment modules, and docs.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, OpenZeppelin Contracts v5, Ethers v6, Mocha, Chai, Hardhat Ignition.

**Spec:** [`docs/superpowers/specs/2026-08-19-pool-level-risk-parameters-design.md`](file:///Users/gnepud/projects/holofi/holofi_protocol/docs/superpowers/specs/2026-08-19-pool-level-risk-parameters-design.md)

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task
- Adhere to Linear integration commit convention `[Magic Word] [TEAM-123]` or conventional commit format

---

### Task 1: Smart Contracts & Solidity Unit Tests Refactoring

**Files:**
- Modify: `contracts/HoloFiLendingPool.sol`
- Modify: `contracts/HoloFiLendingPoolFactory.sol`
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiDutchAuction.sol`
- Modify: `contracts/HoloFiLendingPool.t.sol`
- Modify: `contracts/HoloFiLendingPoolFactory.t.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces:
  - `HoloFiLendingPool`: constructor with 4 risk parameters, `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`, `setRiskParameters(...)`, `InvalidRiskParameters()` error.
  - `HoloFiLendingPoolFactory`: `createPool(IERC20 asset, string name, string symbol, uint256 maxLtvBps, uint256 liquidationThresholdBps, uint256 liquidationPenaltyBps, uint256 borrowRateBpsPerYear)`.
  - `HoloFiVaultLoanCore`: `struct CollateralVault` with `address lendingPool`, `createVault(address lendingPool)`, `borrow(uint256 vaultId, uint256 amount)`, `repay(uint256 vaultId, uint256 amount)`, `repayAndWithdraw(uint256 vaultId, uint256 repayAmount, uint256[] withdrawTokenIds)`.
  - `HoloFiDutchAuction`: `startAuction`, `settleAuction`, and `treasuryBuyback` dynamically querying `vault.lendingPool`.

- [x] **Step 1: Update `contracts/HoloFiLendingPool.sol`**

Add state variables `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`. Update constructor to accept and validate them. Add `setRiskParameters` with `onlyAdmin` modifier.

- [x] **Step 2: Update `contracts/HoloFiLendingPoolFactory.sol`**

Update `createPool` signature to take `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`, deploy `HoloFiLendingPool` with these parameters, and emit `PoolCreated`.

- [x] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol`**

Add `address lendingPool` to `CollateralVault`. Update `createVault(address lendingPool)` to validate `poolFactory.isValidPool(lendingPool)`. Remove global risk variables and `setRiskParameters`. Update `accrueInterest`, `getPendingInterest`, `getHealthFactor`, `getMaxBorrowCapacity`, `withdrawCollateral`, `borrow`, `repay`, and `repayAndWithdraw` to dynamically read risk parameters and return liquidity directly to `vault.lendingPool`.

- [x] **Step 4: Update `contracts/HoloFiDutchAuction.sol`**

Update `startAuction` to read `liquidationPenaltyBps` from `vault.lendingPool`. Update `settleAuction` and `treasuryBuyback` to return debt liquidity directly to `vault.lendingPool`.

- [x] **Step 5: Update all Solidity unit tests (`contracts/*.t.sol`)**

Update `HoloFiLendingPool.t.sol`, `HoloFiLendingPoolFactory.t.sol`, `HoloFiVaultLoanCore.t.sol`, and `HoloFiDutchAuction.t.sol` for new constructor signatures, `createVault(address lendingPool)`, simplified `borrow(vaultId, amount)` and `repay(vaultId, amount)`.

- [x] **Step 6: Run Solidity unit tests to verify**

Run: `npx hardhat test solidity`
Expected: PASS (all Solidity unit tests pass cleanly).

- [x] **Step 7: Commit Task 1**

```bash
git add contracts/
git commit -m "feat: refactor risk parameters to HoloFiLendingPool and bind pool in createVault"
```

---

### Task 2: Ignition Modules, TypeScript Integration Tests, Scripts & Documentation

**Files:**
- Modify: `ignition/modules/DeployHoloFiLendingPool.ts`
- Modify: `ignition/modules/DeployHoloFiLendingPoolWithMock.ts`
- Modify: `test/HoloFiLendingPool.ts`
- Modify: `test/HoloFiLendingPoolFactory.ts`
- Modify: `test/HoloFiVaultLoanCore.ts`
- Modify: `test/HoloFiDutchAuction.ts`
- Modify: `test/DeployHoloFiProtocol.ts`
- Modify: `test/ViewCardScript.ts`
- Modify: `docs/System Architecture Document.md`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Consumes: Refactored `HoloFiLendingPool`, `HoloFiLendingPoolFactory`, `HoloFiVaultLoanCore`, `HoloFiDutchAuction`.
- Produces: Updated Hardhat Ignition deployment modules, 100% passing TypeScript test suite, and updated architectural documentation.

- [x] **Step 1: Update Hardhat Ignition modules**

Update `DeployHoloFiLendingPool.ts` and `DeployHoloFiLendingPoolWithMock.ts` to pass `maxLtvBps` (5000), `liquidationThresholdBps` (7000), `liquidationPenaltyBps` (1000), and `borrowRateBpsPerYear` (500) parameters to `poolFactory.createPool`.

- [x] **Step 2: Update TypeScript integration tests**

Update `test/HoloFiLendingPool.ts`, `test/HoloFiLendingPoolFactory.ts`, `test/HoloFiVaultLoanCore.ts`, `test/HoloFiDutchAuction.ts`, `test/DeployHoloFiProtocol.ts`, and `test/ViewCardScript.ts` to reflect the updated `createPool`, `createVault(lendingPoolAddress)`, `borrow(vaultId, amount)`, and `repay(vaultId, amount)` calls.

- [x] **Step 3: Update System Architecture and Deployment Guide documentation**

Update `docs/System Architecture Document.md` and `docs/Deployment Guide.md` to document the pool-level risk parameters, `CollateralVault` pool binding, and simplified borrow/repay signatures.

- [x] **Step 4: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (all 280+ tests pass with 0 TypeScript/Solidity errors).

- [x] **Step 5: Commit Task 2**

```bash
git add ignition/ test/ docs/
git commit -m "test: update integration tests, deployment modules, and architecture docs for pool-level risk refactoring"
```
