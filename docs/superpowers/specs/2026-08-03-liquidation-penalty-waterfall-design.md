# Liquidation Penalty & Collateral Waterfall Accounting Specification

- **Feature**: HF-34 — Liquidation Penalty & Collateral Waterfall Accounting (`HoloFiDutchAuction` & `HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-03
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature incorporates protocol-configurable liquidation penalties (`liquidationPenaltyBps`) into open-market Dutch Auction pricing and implements a secure, CEI-compliant, single-approval 5-step waterfall fund distribution in `HoloFiDutchAuction.sol`:
1. **Pull Funds**: `HoloFiDutchAuction` pulls the full execution payment (`currentPrice`) from the Liquidator (`msg.sender`) into `address(this)` via `safeTransferFrom`.
2. **Loan Debt Clearance**: `HoloFiDutchAuction` approves `lendingPool` for `debtAmount` via `forceApprove`, then calls `HoloFiLendingPool(lendingPool).returnLiquidity(address(this), debtAmount)` to clear the actual loan debt without debt ledger distortion.
3. **Penalty Surcharge**: `HoloFiDutchAuction` transfers the liquidation penalty (`penaltyAmount`) directly into the `HoloFiLendingPool` contract via `safeTransfer` to boost ERC-4626 LP vault assets.
4. **Residual Equity Surplus**: `HoloFiDutchAuction` transfers remaining execution proceeds (`surplus = currentPrice - reservePrice`) directly to the original store wallet (`vault.owner`) via `safeTransfer`.
5. **Finalize & Release Collateral**: `HoloFiDutchAuction` calls `loanCore.finalizeLiquidation(vaultId, msg.sender)` to unlock and transfer card NFTs to the winning liquidator.

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiDutchAuction.sol`
* **Dependencies**: `@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol`, `@openzeppelin/contracts/utils/ReentrancyGuard.sol`, `contracts/AccessControlManager.sol`, `contracts/HoloFiVaultLoanCore.sol`, `contracts/HoloFiLendingPool.sol`, `contracts/HoloFiLendingPoolFactory.sol`

### 2.2 Core Struct, Custom Errors & Event Extensions

```solidity
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract HoloFiDutchAuction is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Auction {
        uint256 vaultId;
        uint256 startFmv;
        uint256 startPrice;
        uint256 debtAmount;      // Principal + accrued interest
        uint256 penaltyAmount;   // Liquidation penalty (debtAmount * liquidationPenaltyBps / 10000)
        uint256 reservePrice;    // debtAmount + penaltyAmount
        uint256 startTime;
        uint256 duration;
        address seller;
        bool isSettled;
    }

    event AuctionSettled(
        uint256 indexed vaultId,
        address indexed liquidator,
        address indexed lendingPool,
        uint256 finalPrice,
        uint256 debtPaid,
        uint256 penaltyPaid,
        uint256 surplusToSeller
    );

    error InsufficientAuctionPrice(uint256 currentPrice, uint256 reservePrice);
    // ... existing errors
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

### 2.4 Production-Grade CEI & SafeERC20 Settlement (`settleAuction`)

```solidity
function settleAuction(uint256 vaultId, address lendingPool) external nonReentrant {
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
    uint256 reservePrice = auction.reservePrice; // debtPaid + penaltyPaid

    // 1. Boundary Guard: Prevent execution below reserve floor price
    if (currentPrice < reservePrice) {
        revert InsufficientAuctionPrice(currentPrice, reservePrice);
    }

    uint256 surplus = currentPrice - reservePrice;

    // 2. State Mutation: CEI Pattern (Checks-Effects-Interactions)
    auction.isSettled = true;

    IERC20 asset = IERC20(HoloFiLendingPool(lendingPool).asset());

    // Step 1: Pull full currentPrice from liquidator to contract
    asset.safeTransferFrom(msg.sender, address(this), currentPrice);

    // Step 2: Approve & return loan debt (debtPaid) to LendingPool
    asset.forceApprove(lendingPool, debtPaid);
    HoloFiLendingPool(lendingPool).returnLiquidity(address(this), debtPaid);

    // Step 3: Transfer penalty surcharge directly into LendingPool contract
    if (penaltyPaid > 0) {
        asset.safeTransfer(lendingPool, penaltyPaid);
    }

    // Step 4: Refund residual equity surplus to original store (Vault Owner)
    if (surplus > 0) {
        asset.safeTransfer(auction.seller, surplus);
    }

    // Step 5: Finalize liquidation status, unlock & transfer collateral NFTs to liquidator
    loanCore.finalizeLiquidation(vaultId, msg.sender);

    emit AuctionSettled(vaultId, msg.sender, lendingPool, currentPrice, debtPaid, penaltyPaid, surplus);
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. `test_StartAuction_IncludesLiquidationPenalty`: Verifies `reservePrice == totalDebt + penaltyAmount` (10% of debt) and `auction.penaltyAmount == totalDebt * 10%`.
2. `test_RevertIf_SettleAuction_InsufficientAuctionPrice`: Force mock condition where `currentPrice < reservePrice`, verifying revert with `InsufficientAuctionPrice`.
3. `test_SettleAuction_ProductionWaterfallDistribution`: Time warp 24h. Liquidator approves ONLY `dutchAuction` for `currentPrice` ($5,000) and calls `settleAuction`.
   - Asserts `returnLiquidity` receives `debtPaid` ($4,000) from `dutchAuction`.
   - Asserts `lendingPool` receives `penaltyPaid` ($400) via `safeTransfer`.
   - Asserts `vault.owner` receives `surplus` ($600) via `safeTransfer`.
   - Asserts card NFTs are transferred to liquidator.

### 3.2 TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)
1. Update `test/HoloFiDutchAuction.ts`:
   - Execute end-to-end auction settlement with single approval (`asset.connect(liquidator).approve(dutchAuctionAddr, currentPrice)`).
   - Assert `HoloFiLendingPool` asset balance is restored with debt + penalty ($100,000 + $400 penalty = $100,400 EURC).
   - Assert `store` receives residual surplus ($600 EURC).
   - Assert liquidator owns the unlocked card NFTs.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
