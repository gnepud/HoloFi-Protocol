# LTV, Interest Accrual & Protocol Risk Engine Specification

- **Feature**: HF-21 — LTV, Interest Accrual & Protocol Risk Engine Config (`HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-01
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiVaultLoanCore` smart contract manages protocol-wide risk parameters, continuous interest accrual calculations, Health Factor evaluations, and max borrow capacity math for isolated store collateral vaults.

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`

### 2.2 Risk Parameters & Constants

```solidity
uint256 public constant BPS_DENOMINATOR = 10000;
uint256 public constant SECONDS_PER_YEAR = 365 days;
uint256 public constant HEALTH_FACTOR_PRECISION = 1e18;

uint256 public maxLtvBps = 5000;                // Max LTV: 50.00%
uint256 public liquidationThresholdBps = 7000; // Liquidation Threshold: 70.00%
uint256 public liquidationPenaltyBps = 1000;   // Liquidation Penalty: 10.00%
uint256 public borrowRateBpsPerYear = 500;      // Borrow Rate: 5.00% APY

event RiskParametersUpdated(
    uint256 maxLtvBps,
    uint256 liquidationThresholdBps,
    uint256 liquidationPenaltyBps,
    uint256 borrowRateBpsPerYear
);

event InterestAccrued(
    uint256 indexed vaultId,
    uint256 interestAccrued,
    uint256 totalAccumulatedInterest,
    uint256 timestamp
);
```

### 2.3 Custom Errors
* `InvalidRiskParameters()`: Parameter validation failed (e.g. `_maxLtvBps > _liquidationThresholdBps` or `_liquidationThresholdBps > BPS_DENOMINATOR`).
* `UnauthorizedAdmin(address caller)`: Non-admin caller attempted to update risk parameters.

### 2.4 Functions

#### `setRiskParameters(uint256 _maxLtvBps, uint256 _liquidationThresholdBps, uint256 _liquidationPenaltyBps, uint256 _borrowRateBpsPerYear) external`
- **Access Control**: Reverts `UnauthorizedAdmin(msg.sender)` if `!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)`.
- **Validation**: Reverts `InvalidRiskParameters()` if `_maxLtvBps > _liquidationThresholdBps` or `_liquidationThresholdBps > BPS_DENOMINATOR`.
- **Logic**: Updates state variables and emits `RiskParametersUpdated`.

#### `accrueInterest(uint256 vaultId) public`
- Calculates elapsed time $\Delta t = \text{block.timestamp} - \text{vault.lastInterestUpdate}$.
- If $\Delta t > 0$:
  - If `vault.principalDebt > 0`:
    - $\text{interestNew} = \frac{\text{vault.principalDebt} \times \text{borrowRateBpsPerYear} \times \Delta t}{\text{BPS\_DENOMINATOR} \times \text{SECONDS\_PER\_YEAR}}$
    - `vault.accumulatedInterest += interestNew`
    - Emits `InterestAccrued(vaultId, interestNew, vault.accumulatedInterest, block.timestamp)`.
  - `vault.lastInterestUpdate = block.timestamp`.

#### `getPendingInterest(uint256 vaultId) public view returns (uint256)`
- Calculates pending un-accrued interest for `vaultId` since `lastInterestUpdate` without mutating state. Returns 0 if `principalDebt == 0` or `dt == 0`.

#### `getTotalDebt(uint256 vaultId) public view returns (uint256)`
- Returns `vault.principalDebt + vault.accumulatedInterest + getPendingInterest(vaultId)`.

#### `calculateHealthFactor(uint256 vaultFmv, uint256 totalDebt) public pure returns (uint256)`
- If `totalDebt == 0`: Returns `type(uint256).max`.
- Otherwise, returns $\frac{\text{vaultFmv} \times \text{liquidationThresholdBps} \times 1\text{e}18}{\text{totalDebt} \times 10000}$.

#### `getHealthFactor(uint256 vaultId, uint256 vaultFmv) public view returns (uint256)`
- Helper calling `calculateHealthFactor(vaultFmv, getTotalDebt(vaultId))`.

#### `getMaxBorrowCapacity(uint256 vaultFmv) public view returns (uint256)`
- Returns $\frac{\text{vaultFmv} \times \text{maxLtvBps}}{10000}$.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiVaultLoanCore.t.sol`)
1. `test_SetRiskParameters_Success`: Admin updates parameters, verifying state and `RiskParametersUpdated` event emission.
2. `test_RevertIf_SetRiskParameters_Unauthorized`: Non-admin caller reverts `UnauthorizedAdmin`.
3. `test_RevertIf_SetRiskParameters_InvalidParameters`: Passing `_maxLtvBps > _liquidationThresholdBps` reverts `InvalidRiskParameters`.
4. `test_AccrueInterest_TimeWarp`: Set principal debt, advance time via `vm.warp(365 days)`, call `accrueInterest(vaultId)`, verify 5% interest accrued and `lastInterestUpdate` updated.
5. `test_CalculateHealthFactor_ZeroDebt`: Verify returns `type(uint256).max`.
6. `test_CalculateHealthFactor_AboveAndBelowOne`: Test $HF > 1\text{e}18$ for safe collateral ratio and $HF < 1\text{e}18$ for undercollateralized state.
7. `test_GetMaxBorrowCapacity`: Verify max borrow capacity equals `vaultFmv * 50%`.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)
1. Admin configures risk parameters via `setRiskParameters`.
2. Verify `getMaxBorrowCapacity` and `calculateHealthFactor` helpers.
3. Time warp with Hardhat network helper `networkHelpers.time.increase(86400 * 365)` to verify accrued interest calculation over 1 year.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
