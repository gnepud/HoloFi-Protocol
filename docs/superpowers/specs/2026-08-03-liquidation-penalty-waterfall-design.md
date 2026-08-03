# Liquidation Penalty & Collateral Waterfall Accounting Specification

- **Feature**: HF-34 — Liquidation Penalty & Collateral Waterfall Accounting (`HoloFiDutchAuction` & `HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-03
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature incorporates protocol-configurable liquidation penalties (`liquidationPenaltyBps`) into open-market Dutch Auction pricing and implements a 3-tier settlement waterfall in `HoloFiDutchAuction.sol`. Upon auction settlement, payment proceeds are distributed in rank order to: (1) 100% principal & accrued interest recovery for `HoloFiLendingPool`, (2) liquidation penalty surcharge for the protocol `treasury`, and (3) residual equity surplus refund to the original store wallet (`vault.owner`).

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiDutchAuction.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiVaultLoanCore.sol`, `contracts/HoloFiLendingPool.sol`, `contracts/HoloFiLendingPoolFactory.sol`

### 2.2 Core Struct & State Extensions

```solidity
struct Auction {
    uint256 vaultId;
    uint256 startFmv;
    uint256 startPrice;
    uint256 debtAmount;      // Principal + accrued interest
    uint256 penaltyAmount;   // Liquidation penalty (totalDebt * liquidationPenaltyBps / 10000)
    uint256 reservePrice;    // debtAmount + penaltyAmount
    uint256 startTime;
    uint256 duration;
    address seller;
    bool isSettled;
}

address public treasury;

event TreasuryUpdated(address indexed newTreasury);
event AuctionSettled(
    uint256 indexed vaultId,
    address indexed liquidator,
    address indexed lendingPool,
    uint256 finalPrice,
    uint256 debtPaid,
    uint256 penaltyPaid,
    uint256 surplusToSeller
);

error ZeroAddressTreasury();

function setTreasury(address _treasury) external {
    if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
        revert UnauthorizedAdmin(msg.sender);
    }
    if (_treasury == address(0)) {
        revert ZeroAddressTreasury();
    }
    treasury = _treasury;
    emit TreasuryUpdated(_treasury);
}
```

### 2.3 Reserve Floor Calculation (`startAuction`)

```solidity
function startAuction(uint256 vaultId) external {
    Auction storage auction = auctions[vaultId];
    if (auction.startTime != 0 && !auction.isSettled) {
        revert AuctionAlreadyStarted(vaultId);
    }

    loanCore.startLiquidation(vaultId);

    uint256 startFmv = loanCore.getVaultFMV(vaultId);
    uint256 totalDebt = loanCore.getTotalDebt(vaultId);
    uint256 penaltyBps = loanCore.liquidationPenaltyBps();

    uint256 penaltyAmount = (totalDebt * penaltyBps) / BPS_DENOMINATOR;
    uint256 reservePrice = totalDebt + penaltyAmount;

    uint256 startPrice = (startFmv * START_PRICE_BPS) / BPS_DENOMINATOR;
    if (startPrice < reservePrice) {
        startPrice = reservePrice;
    }

    HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);

    auctions[vaultId] = Auction({
        vaultId: vaultId,
        startFmv: startFmv,
        startPrice: startPrice,
        debtAmount: totalDebt,
        penaltyAmount: penaltyAmount,
        reservePrice: reservePrice,
        startTime: block.timestamp,
        duration: DEFAULT_AUCTION_DURATION,
        seller: vault.owner,
        isSettled: false
    });

    emit AuctionStarted(vaultId, startPrice, reservePrice, block.timestamp, DEFAULT_AUCTION_DURATION);
}
```

### 2.4 3-Tier Settlement Waterfall (`settleAuction`)

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
    uint256 debtPaid = auction.debtAmount;
    uint256 penaltyPaid = auction.penaltyAmount;
    uint256 reservePrice = auction.reservePrice;
    uint256 surplus = currentPrice > reservePrice ? currentPrice - reservePrice : 0;

    auction.isSettled = true;

    IERC20 asset = HoloFiLendingPool(lendingPool).asset();

    // 1. Primary Debt Recovery to Lending Pool
    HoloFiLendingPool(lendingPool).returnLiquidity(msg.sender, debtPaid);

    // 2. Protocol Penalty Surcharge to Treasury
    if (penaltyPaid > 0 && treasury != address(0)) {
        asset.transferFrom(msg.sender, treasury, penaltyPaid);
    }

    // 3. Residual Equity Surplus to Original Store
    if (surplus > 0) {
        asset.transferFrom(msg.sender, auction.seller, surplus);
    }

    // 4. Unlock & Transfer Collateral NFTs to Liquidator
    loanCore.finalizeLiquidation(vaultId, msg.sender);

    emit AuctionSettled(vaultId, msg.sender, lendingPool, currentPrice, debtPaid, penaltyPaid, surplus);
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. `test_SetTreasury_Success`: Admin sets treasury address -> emits `TreasuryUpdated`. Non-admin reverts `UnauthorizedAdmin`. Passing address(0) reverts `ZeroAddressTreasury`.
2. `test_StartAuction_IncludesLiquidationPenalty`: Verifies `reservePrice == totalDebt + penaltyAmount` (10% of debt) and `auction.penaltyAmount == totalDebt * 10%`.
3. `test_SettleAuction_3TierWaterfallDistribution`: Time warp 24h. Liquidator calls `settleAuction`.
   - Asserts 100% of debt transferred to pool.
   - Asserts 100% of `penaltyAmount` transferred to `treasury`.
   - Asserts residual `surplus = currentPrice - reservePrice` transferred to `vault.owner`.
   - Asserts card NFTs transferred to liquidator.

### 3.2 TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)
1. Update `test/HoloFiDutchAuction.ts`:
   - Configure treasury address via `dutchAuction.connect(admin).setTreasury(treasury.address)`.
   - Execute end-to-end auction settlement.
   - Assert token balances for `pool`, `treasury`, and `store` match exact 3-tier waterfall amounts.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
