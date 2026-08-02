# Card Loan Repayment & Full Collateral Release Specification

- **Feature**: HF-23 — Card Loan Repayment & Full Collateral Release (`HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-02
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiVaultLoanCore` smart contract processes debt repayments for active store collateral vaults. Repayments execute an interest-first waterfall allocation, return liquidity to `HoloFiLendingPool`, and reduce vault debt. Once total debt is fully settled (`principalDebt == 0 && accumulatedInterest == 0`), the store can withdraw all vaulted card NFTs.

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiCardCollection.sol`, `contracts/HoloFiLendingPool.sol`

### 2.2 Core Events & Custom Errors

```solidity
event RepaymentExecuted(
    uint256 indexed vaultId,
    address indexed payer,
    address indexed lendingPool,
    uint256 totalRepaid,
    uint256 interestPaid,
    uint256 principalPaid,
    uint256 remainingPrincipalDebt,
    uint256 remainingAccumulatedInterest
);

error ZeroRepayAmount();
error NoActiveDebt(uint256 vaultId);
```

### 2.3 Repayment Function (`repay`)

#### `repay(uint256 vaultId, uint256 amount, address lendingPool) external`
- **Status Guard**: Reverts `VaultNotActive(vaultId)` if `vault.status != VaultStatus.Active`.
- **Amount Check**: Reverts `ZeroRepayAmount()` if `amount == 0`.
- **Interest Guard**: Calls `accrueInterest(vaultId)` FIRST before state changes.
- **Active Debt Guard**: Calculates `totalDebt = vault.accumulatedInterest + vault.principalDebt`. Reverts `NoActiveDebt(vaultId)` if `totalDebt == 0`.
- **Waterfall Allocation**:
  - `actualRepay = amount > totalDebt ? totalDebt : amount`.
  - If `actualRepay <= vault.accumulatedInterest`:
    - `vault.accumulatedInterest -= actualRepay`.
    - `interestPaid = actualRepay`, `principalPaid = 0`.
  - Else (`actualRepay > vault.accumulatedInterest`):
    - `interestPaid = vault.accumulatedInterest`.
    - `principalPaid = actualRepay - interestPaid`.
    - `vault.accumulatedInterest = 0`.
    - `vault.principalDebt -= principalPaid`.
- **Liquidity Return**: Calls `HoloFiLendingPool(lendingPool).returnLiquidity(msg.sender, actualRepay)`.
- **Event Emission**: Emits `RepaymentExecuted(vaultId, msg.sender, lendingPool, actualRepay, interestPaid, principalPaid, vault.principalDebt, vault.accumulatedInterest)`.

### 2.4 Full Collateral Release Mechanism
- Handled by existing `withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds)` function.
- Requires `getTotalDebt(vaultId) == 0`.
- Unlocks NFTs via `nftCollection.setCardLock(tokenId, false)` and transfers cards back to store wallet.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiVaultLoanCore.t.sol`)
1. `test_Repay_PartialInterestAndPrincipal`: Borrow capital, advance time to accrue interest, execute partial repayment covering all interest and part of principal, verifying debt reductions and `LiquidityReturned` event from pool.
2. `test_Repay_FullLoanSettlement`: Execute repayment equal to or exceeding total debt, verifying `principalDebt == 0`, `accumulatedInterest == 0`, and successful full collateral release via `withdrawCollateral`.
3. `test_RevertIf_Repay_ZeroAmount`: Repaying 0 amount reverts `ZeroRepayAmount`.
4. `test_RevertIf_Repay_NoActiveDebt`: Repaying vault with zero debt reverts `NoActiveDebt`.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)
1. Store borrows funds, time warps to accrue interest, approves lending pool for underlying asset tokens, executes `repay` for partial and full debt payoff.
2. Asserts `RepaymentExecuted` event emission and asset balance return to pool.
3. Store calls `withdrawCollateral` to reclaim all card NFTs after full payoff, verifying card unlocked status (`isLocked == false`) and store NFT ownership.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
