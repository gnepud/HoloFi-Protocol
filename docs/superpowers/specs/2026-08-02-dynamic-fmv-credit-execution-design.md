# Dynamic FMV Integration & Credit Execution Specification

- **Feature**: HF-22 — Dynamic FMV Integration & Credit Execution (`HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-02
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiVaultLoanCore` smart contract integrates card Fair Market Value (FMV) valuation mappings updated by Chainlink CRE / oracle nodes and executes credit borrowing against store collateral vaults. It enforces pre-execution interest accrual, LTV debt limits, and liquidity drawdowns from `HoloFiLendingPool`.

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiCardCollection.sol`, `contracts/HoloFiLendingPool.sol`

### 2.2 Core State & Mappings

```solidity
mapping(uint256 => uint256) public cardFmv; // tokenId => FMV (e.g. 6-decimal USDC/EURC standard)

event CardFmvUpdated(uint256 indexed tokenId, uint256 fmv);
event BorrowExecuted(
    uint256 indexed vaultId,
    address indexed owner,
    address indexed lendingPool,
    uint256 amount,
    uint256 newPrincipalDebt
);

error UnauthorizedOracle(address caller);
error ZeroBorrowAmount();
error ExceedsMaxBorrowCapacity(uint256 vaultId, uint256 requestedTotalDebt, uint256 maxBorrowCapacity);
error ArrayLengthMismatch();
```

### 2.3 Functions

#### `setCardFmv(uint256 tokenId, uint256 fmv) external`
- **Access Control**: Reverts `UnauthorizedOracle(msg.sender)` if `!acm.hasRole(acm.ORACLE_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)`.
- **Logic**: Sets `cardFmv[tokenId] = fmv` and emits `CardFmvUpdated(tokenId, fmv)`.

#### `setBatchCardFmv(uint256[] calldata tokenIds, uint256[] calldata fmvs) external`
- **Access Control**: Reverts `UnauthorizedOracle(msg.sender)` if unauthorized.
- **Validation**: Reverts `ArrayLengthMismatch()` if `tokenIds.length != fmvs.length`.
- **Logic**: Iterates and sets `cardFmv[tokenIds[i]] = fmvs[i]`, emitting `CardFmvUpdated` for each.

#### `getVaultFMV(uint256 vaultId) public view returns (uint256)`
- Sums `cardFmv[tokenId]` across all `tokenIds` in `vaults[vaultId].tokenIds` and returns total vault FMV.

#### `borrow(uint256 vaultId, uint256 amount, address lendingPool) external`
- **Access Control**: Reverts `UnauthorizedVaultOwner(vaultId, msg.sender)` if `msg.sender != vault.owner`.
- **Status Guard**: Reverts `VaultNotActive(vaultId)` if `vault.status != VaultStatus.Active`.
- **Amount Check**: Reverts `ZeroBorrowAmount()` if `amount == 0`.
- **Interest Guard**: Calls `accrueInterest(vaultId)` FIRST before state changes.
- **LTV Capacity Guard**:
  - Calculates `vaultFmv = getVaultFMV(vaultId)`.
  - Calculates `maxBorrow = getMaxBorrowCapacity(vaultFmv)`.
  - Calculates `newTotalDebt = getTotalDebt(vaultId) + amount`.
  - Reverts `ExceedsMaxBorrowCapacity(vaultId, newTotalDebt, maxBorrow)` if `newTotalDebt > maxBorrow`.
- **Execution**:
  - Updates `vault.principalDebt += amount`.
  - Executes `HoloFiLendingPool(lendingPool).drawLiquidity(vault.owner, amount)`.
  - Emits `BorrowExecuted(vaultId, vault.owner, lendingPool, amount, vault.principalDebt)`.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiVaultLoanCore.t.sol`)
1. `test_SetCardFmv_Success`: Oracle updates card FMV, verifying `cardFmv[tokenId]` and `CardFmvUpdated` event.
2. `test_SetBatchCardFmv_Success`: Oracle updates batch FMVs, verifying mapping values and event emissions.
3. `test_RevertIf_SetCardFmv_Unauthorized`: Non-oracle caller reverts `UnauthorizedOracle`.
4. `test_RevertIf_SetBatchCardFmv_LengthMismatch`: Mismatched array lengths revert `ArrayLengthMismatch`.
5. `test_GetVaultFMV`: Deposit 2 cards with set FMVs, verify `getVaultFMV(vaultId)` equals sum of card FMVs.
6. `test_Borrow_Success`: Store deposits collateral with FMV = $10,000, borrows $4,000 EURC from `HoloFiLendingPool`, verifying principal debt update, `LiquidityDrawn` event from lending pool, and recipient balance.
7. `test_RevertIf_Borrow_ExceedsMaxBorrowCapacity`: Attempting to borrow $6,000 against $10,000 FMV (50% max LTV = $5,000) reverts `ExceedsMaxBorrowCapacity`.
8. `test_RevertIf_Borrow_UnauthorizedOwner`: Non-owner attempting to borrow reverts `UnauthorizedVaultOwner`.
9. `test_RevertIf_Borrow_ZeroAmount`: Borrowing 0 amount reverts `ZeroBorrowAmount`.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)
1. Oracle sets card FMVs via `setBatchCardFmv`.
2. Store deposits cards into vault, calls `borrow` from `HoloFiLendingPool`, verifying principal debt increase, share pool total borrowed update, and token transfers.
3. Store attempts borrow exceeding max LTV -> reverts with `ExceedsMaxBorrowCapacity`.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
