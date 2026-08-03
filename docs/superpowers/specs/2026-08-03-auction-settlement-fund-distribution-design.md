# Auction Settlement & Fund Distribution Specification

- **Feature**: HF-27 — Auction Settlement & Fund Distribution (`settleAuction` & `finalizeLiquidation`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-03
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature implements the settlement and fund distribution logic for Dutch Auctions in `HoloFiDutchAuction.sol` (`settleAuction`) and the corresponding collateral unlocking and transfer hook in `HoloFiVaultLoanCore.sol` (`finalizeLiquidation`). Liquidators can bid on active Dutch Auctions by paying the current auction price, repaying pool debt, transferring equity surplus to the store, and receiving the underlying card NFTs.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Contracts**: `contracts/HoloFiDutchAuction.sol`, `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiCardCollection.sol`, `contracts/HoloFiLendingPoolFactory.sol`, `contracts/HoloFiLendingPool.sol`

### 2.2 `HoloFiVaultLoanCore.sol` Finalization Hook

```solidity
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
    vault.status = VaultStatus.Liquidated;

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

### 2.3 `HoloFiDutchAuction.sol` Settlement Function

```solidity
function settleAuction(uint256 vaultId, address lendingPool) external {
    Auction storage auction = auctions[vaultId];
    if (auction.startTime == 0 || auction.isSettled) {
        revert AuctionNotActive(vaultId);
    }
    if (!poolFactory.isValidPool(lendingPool)) {
        revert UnregisteredLendingPool(lendingPool);
    }

    uint256 currentPrice = getAuctionPrice(vaultId);
    uint256 debtPaid = auction.reservePrice;
    uint256 surplus = currentPrice > debtPaid ? currentPrice - debtPaid : 0;

    auction.isSettled = true;

    // 1. Pay off pool debt
    HoloFiLendingPool(lendingPool).returnLiquidity(msg.sender, debtPaid);

    // 2. Transfer surplus to original store
    if (surplus > 0) {
        IERC20 asset = HoloFiLendingPool(lendingPool).asset();
        asset.transferFrom(msg.sender, auction.seller, surplus);
    }

    // 3. Complete liquidation and transfer NFTs to liquidator
    loanCore.finalizeLiquidation(vaultId, msg.sender);

    emit AuctionSettled(vaultId, msg.sender, lendingPool, currentPrice, debtPaid, surplus);
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. `test_SettleAuction_WithSurplus`: Store borrows debt, card FMV drops causing $HF < 1.0$, auction starts. Time warps 12 hours (current price = $5,000, debt = $4,000, surplus = $1,000). Liquidator calls `settleAuction(vaultId, pool)`.
   - Pool receives $4,000 debt payoff.
   - Original store receives $1,000 surplus refund.
   - Liquidator receives card NFT (`ownerOf(cardId1) == liquidator`).
   - Vault debt cleared (`principalDebt == 0`, `status == Liquidated`).
2. `test_SettleAuction_AtReservePrice`: Time warps 48 hours (current price = reserve price = $4,000, surplus = 0). Liquidator calls `settleAuction`. Only debt payoff is transferred.
3. `test_RevertIf_SettleAuction_UnregisteredPool`: Bidding with an unapproved pool address reverts `UnregisteredLendingPool`.
4. `test_RevertIf_SettleAuction_AlreadySettled`: Calling `settleAuction` on an already settled auction reverts `AuctionNotActive`.

### 3.2 TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)
1. Create `test/HoloFiDutchAuction.ts` to test full end-to-end liquidation lifecycle using Hardhat 3 `network.create()`, `loadFixture`, Ethers v6, and Chai matchers:
   - Deploy system (`ACM`, `CardCollection`, `PoolFactory`, `LoanCore`, `DutchAuction`).
   - Store creates vault, deposits cards, borrows capital from `HoloFiLendingPool`.
   - Oracle drops card FMV so $HF < 1.0$.
   - Liquidator triggers `startAuction(1n)`.
   - Time warp 24 hours.
   - Liquidator approves asset and calls `settleAuction(1n, poolAddr)`.
   - Verifies pool balance, store surplus balance, and liquidator NFT ownership.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
