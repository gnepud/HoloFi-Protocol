# Dutch Auction Price Decay Algorithm Specification

- **Feature**: HF-26 — Dutch Auction Price Decay Algorithm (`startAuction` & `getAuctionPrice`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-03
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature implements the auction initiation logic (`startAuction`) and the continuous 48-hour linear price decay algorithm (`getAuctionPrice`) in `HoloFiDutchAuction.sol`. An auction can be started by any user whenever a vault's Health Factor drops below 1.0 ($HF < 1.0$). The start price is set to 120% of the Vault FMV (using `12000` BPS) and decays linearly over 48 hours down to the reserve price floor (total debt).

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Contracts**: `contracts/HoloFiDutchAuction.sol`, `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiCardCollection.sol`, `contracts/HoloFiLendingPoolFactory.sol`

### 2.2 Basis Points & Price Decay Constants (`HoloFiDutchAuction.sol`)

```solidity
uint256 public constant BPS_DENOMINATOR = 10000;
uint256 public constant START_PRICE_BPS = 12000; // 120.00%
uint256 public constant DEFAULT_AUCTION_DURATION = 48 hours;
```

### 2.3 `HoloFiVaultLoanCore.sol` Liquidation Hook

```solidity
function startLiquidation(uint256 vaultId) external {
    if (msg.sender != dutchAuction) {
        revert UnauthorizedAuction(msg.sender);
    }
    CollateralVault storage vault = vaults[vaultId];
    if (vault.status != VaultStatus.Active) {
        revert VaultNotActive(vaultId);
    }

    accrueInterest(vaultId);

    uint256 fmv = getVaultFMV(vaultId);
    uint256 totalDebt = getTotalDebt(vaultId);
    uint256 hf = calculateHealthFactor(fmv, totalDebt);

    if (hf >= HEALTH_FACTOR_PRECISION) {
        revert VaultNotEligibleForLiquidation(vaultId, hf);
    }

    vault.status = VaultStatus.Liquidating;
    emit VaultLiquidationStarted(vaultId);
}
```

### 2.4 `HoloFiDutchAuction.sol` Price Decay Functions

```solidity
function startAuction(uint256 vaultId) external {
    Auction storage auction = auctions[vaultId];
    if (auction.startTime != 0 && !auction.isSettled) {
        revert AuctionAlreadyStarted(vaultId);
    }

    loanCore.startLiquidation(vaultId);

    uint256 startFmv = loanCore.getVaultFMV(vaultId);
    uint256 totalDebt = loanCore.getTotalDebt(vaultId);

    uint256 startPrice = (startFmv * START_PRICE_BPS) / BPS_DENOMINATOR;
    uint256 reservePrice = totalDebt;
    if (startPrice < reservePrice) {
        startPrice = reservePrice;
    }

    HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);

    auctions[vaultId] = Auction({
        vaultId: vaultId,
        startFmv: startFmv,
        startPrice: startPrice,
        reservePrice: reservePrice,
        startTime: block.timestamp,
        duration: DEFAULT_AUCTION_DURATION,
        seller: vault.owner,
        isSettled: false
    });

    emit AuctionStarted(vaultId, startPrice, reservePrice, block.timestamp, DEFAULT_AUCTION_DURATION);
}

function getAuctionPrice(uint256 vaultId) public view returns (uint256) {
    Auction memory auction = auctions[vaultId];
    if (auction.startTime == 0 || auction.isSettled) {
        return 0;
    }

    uint256 elapsed = block.timestamp - auction.startTime;
    if (elapsed >= auction.duration) {
        return auction.reservePrice;
    }

    uint256 priceDrop = ((auction.startPrice - auction.reservePrice) * elapsed) / auction.duration;
    return auction.startPrice - priceDrop;
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. `test_StartAuction_Success`: Store borrows against collateral, oracle drops card FMV so $HF < 1.0$. `startAuction(vaultId)` succeeds, vault status becomes `Liquidating`, `AuctionStarted` event is emitted.
2. `test_RevertIf_StartAuction_HealthyVault`: Calling `startAuction` on a healthy vault ($HF \ge 1.0$) reverts `VaultNotEligibleForLiquidation`.
3. `test_RevertIf_StartAuction_AlreadyStarted`: Attempting to start an auction on a vault that is already liquidating reverts `AuctionAlreadyStarted`.
4. `test_GetAuctionPrice_LinearDecay`:
   - $t = 0$: Returns $P_{\text{start}}$ (120% FMV).
   - $t = 24\text{ hours}$ ($T/2$): Returns exact midpoint $(P_{\text{start}} + P_{\text{reserve}}) / 2$.
   - $t = 48\text{ hours}$ ($T$): Returns $P_{\text{reserve}}$ (total debt).
   - $t = 60\text{ hours}$ ($t > T$): Caps at $P_{\text{reserve}}$.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
