# Vault Lifecycle State Simplification Specification

- **Feature**: HF-36 — Vault Lifecycle State Simplification (`HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-04
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature simplifies the `VaultStatus` enum in `HoloFiVaultLoanCore.sol` by removing the redundant `Liquidated` state and enforcing a clean 3-state lifecycle: `{ Active, Liquidating, Closed }`. `VaultStatus.Closed` serves as the single, unified terminal state for all fully settled vaults—whether closed via normal repayment, Dutch Auction settlement, or Protocol Treasury buyback.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Contracts**: `contracts/HoloFiVaultLoanCore.sol`
* **Tests**: `contracts/HoloFiDutchAuction.t.sol`, `test/HoloFiDutchAuction.ts`

### 2.2 Enum & Function Finality Transition (`HoloFiVaultLoanCore.sol`)

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
    vault.status = VaultStatus.Closed; // Unified terminal state

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

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. Update `test_SettleAuction_WithSurplus`, `test_SettleAuction_SingleApprovalWaterfallDistribution`, `test_SettleAuction_AtReservePrice`, and `test_TreasuryBuyback_Success` to assert `vault.status == HoloFiVaultLoanCore.VaultStatus.Closed` (`2`).

### 3.2 TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)
1. Update integration tests to assert `vaultInfo.status == 2n` (`VaultStatus.Closed`).

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
