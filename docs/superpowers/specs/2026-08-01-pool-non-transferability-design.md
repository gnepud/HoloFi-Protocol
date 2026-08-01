# ERC-4626 Share Token Non-Transferability Specification

- **Feature**: HF-16 — Non-Transferability Constraints to ERC-4626 Pools
- **Status**: Draft / Approved Design
- **Date**: 2026-08-01
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiLendingPool` contract issues yield-bearing `pToken` shares to Liquidity Providers (LPs) upon deposit. To enforce a closed-loop "deposit-to-redeem" model and prevent secondary market trading of share tokens, all secondary transfers of `pToken` shares are disallowed.

---

## 2. Technical Specification

### 2.1 File Location & Dependencies
* **Target Contract**: `contracts/HoloFiLendingPool.sol`
* **Base Contract**: `@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol`

### 2.2 Custom Error
* `ShareTokenNonTransferable()`: Reverts when a transfer of share tokens is attempted between non-zero addresses (`from != address(0)` && `to != address(0)`).

### 2.3 Overridden ERC-20 Internal Hook

#### `_update(address from, address to, uint256 value) internal override`
- **Minting (`from == address(0)`)**: Calls `super._update(from, to, value)` directly (allows `deposit` and `mint`).
- **Burning (`to == address(0)`)**: Calls `super._update(from, to, value)` directly (allows `withdraw` and `redeem`).
- **Transferring (`from != address(0)` && `to != address(0)`)**:
  1. Revert custom error `ShareTokenNonTransferable()`.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiLendingPool.t.sol`)
1. `test_RevertIf_TransferShareToken`: Mint shares to LP via `deposit`, attempt `transfer(user, shares)` and verify revert with `ShareTokenNonTransferable()`.
2. `test_RevertIf_TransferFromShareToken`: Approve `user` for shares, attempt `transferFrom(lp, user, shares)` and verify revert with `ShareTokenNonTransferable()`.

### 3.2 TypeScript Integration Tests (`test/HoloFiLendingPool.ts`)
1. LP deposits EURC and receives `pEURC` shares.
2. Verify LP attempting `transfer` of `pEURC` to another account reverts with custom error `ShareTokenNonTransferable`.
3. Verify LP attempting `transferFrom` of `pEURC` reverts with custom error `ShareTokenNonTransferable`.
4. Verify LP can successfully `redeem` `pEURC` shares for EURC.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
