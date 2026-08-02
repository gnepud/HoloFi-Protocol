# Partial Repayment & Flexible Collateral Release Specification

- **Feature**: HF-31 — Partial Repayment & Flexible Collateral Release (`HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-02
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature enables granular inventory management for store merchants in `HoloFiVaultLoanCore`. Store merchants can release specific collateral NFTs when vault card values appreciate or when executing partial debt repayments, provided the remaining vault collateral satisfies $HF \ge 1.0$ (remaining debt $\le$ remaining max borrow capacity).

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiCardCollection.sol`, `contracts/HoloFiLendingPool.sol`

### 2.2 Core Events & Custom Errors

```solidity
error InsufficientCollateralRatio(uint256 vaultId, uint256 totalDebt, uint256 remainingMaxBorrow);
```

### 2.3 LTV-Guarded `withdrawCollateral`

```solidity
function withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) public {
    CollateralVault storage vault = vaults[vaultId];
    if (vault.owner != msg.sender) {
        revert UnauthorizedVaultOwner(vaultId, msg.sender);
    }
    if (vault.status != VaultStatus.Active) {
        revert VaultNotActive(vaultId);
    }
    uint256 len = tokenIds.length;
    if (len == 0) {
        revert EmptyTokenIdsList();
    }

    accrueInterest(vaultId);

    uint256 currentTotalDebt = getTotalDebt(vaultId);

    // 1. Validation & LTV Check Stage (Runs if active debt exists)
    if (currentTotalDebt > 0) {
        uint256 withdrawnFmv = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = tokenIds[i];
            if (nftVaultId[tokenId] != vaultId) {
                revert TokenNotInVault(tokenId, vaultId);
            }
            withdrawnFmv += cardFmv[tokenId];
        }

        uint256 totalFmv = getVaultFMV(vaultId);
        uint256 remainingFmv = totalFmv > withdrawnFmv ? totalFmv - withdrawnFmv : 0;
        uint256 remainingMaxBorrow = getMaxBorrowCapacity(remainingFmv);

        if (currentTotalDebt > remainingMaxBorrow) {
            revert InsufficientCollateralRatio(vaultId, currentTotalDebt, remainingMaxBorrow);
        }
    }

    // 2. State Updates & Card Transfer Stage
    for (uint256 i = 0; i < len; i++) {
        uint256 tokenId = tokenIds[i];
        if (currentTotalDebt == 0 && nftVaultId[tokenId] != vaultId) {
            revert TokenNotInVault(tokenId, vaultId);
        }

        _removeTokenFromVault(vault, tokenId);
        nftVaultId[tokenId] = 0;
        nftCollection.setCardLock(tokenId, false);
        nftCollection.safeTransferFrom(address(this), vault.owner, tokenId);
    }

    emit CollateralWithdrawn(vaultId, vault.owner, tokenIds);
}
```

### 2.4 Atomic `repayAndWithdraw`

```solidity
function repayAndWithdraw(
    uint256 vaultId,
    uint256 repayAmount,
    address lendingPool,
    uint256[] calldata withdrawTokenIds
) external {
    if (withdrawTokenIds.length > 0) {
        if (vaults[vaultId].owner != msg.sender) {
            revert UnauthorizedVaultOwner(vaultId, msg.sender);
        }
    }

    if (repayAmount > 0) {
        repay(vaultId, repayAmount, lendingPool);
    }

    if (withdrawTokenIds.length > 0) {
        withdrawCollateral(vaultId, withdrawTokenIds);
    }
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiVaultLoanCore.t.sol`)
1. `test_WithdrawCollateral_PartialExcessCollateral`: Deposit 2 cards ($6k + $4k = $10k FMV), borrow $3k (max borrow = $5k). Store withdraws 1 card ($4k FMV), leaving $6k FMV (max borrow = $3k). Remaining collateral covers $3k debt -> succeeds.
2. `test_RevertIf_WithdrawCollateral_InsufficientCollateralRatio`: Attempting to withdraw card leaving $4k FMV (max borrow = $2k) with $3k debt -> reverts `InsufficientCollateralRatio`.
3. `test_PartialRepayAndRelease_Success`: Store repays $1.2k debt and releases 1 card in a single `repayAndWithdraw` call -> succeeds.
4. `test_RevertIf_PartialRepayAndRelease_Unauthorized`: Non-owner attempting `repayAndWithdraw` with `withdrawTokenIds.length > 0` -> reverts `UnauthorizedVaultOwner`.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)
1. Store deposits 2 cards, borrows capital, price appreciates on card 1.
2. Store withdraws excess card without repaying debt -> succeeds.
3. Store calls `partialRepayAndRelease` to pay down debt and withdraw remaining card -> succeeds and restores NFT ownership.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
