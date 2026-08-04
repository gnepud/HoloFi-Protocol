# Protocol Treasury Buyback & Unsold Auction Settlement Specification

- **Feature**: HF-33 — Protocol Treasury Buyback & Unsold Auction Settlement (`HoloFiDutchAuction`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-04
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature implements a backstop buyback mechanism (`treasuryBuyback`) in `HoloFiDutchAuction.sol` for Dutch Auctions that expire after their 48-hour duration without receiving public bids. Execution is restricted to the authorized `treasury` address. The Protocol Treasury repays 100% of the loan debt (`debtAmount`) directly to `HoloFiLendingPool` (waiving the liquidation penalty to maximize protocol capital efficiency), clearing all pool debt with zero bad debt, and receives the underlying card NFTs for off-chain physical liquidation.

---

## 2. Technical Specification

### 2.1 Target File & Dependencies
* **Target Contract**: `contracts/HoloFiDutchAuction.sol`
* **Dependencies**: `@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol`, `@openzeppelin/contracts/utils/ReentrancyGuard.sol`, `contracts/AccessControlManager.sol`, `contracts/HoloFiVaultLoanCore.sol`, `contracts/HoloFiLendingPool.sol`, `contracts/HoloFiLendingPoolFactory.sol`

### 2.2 Core State, Custom Errors & Event Extensions

```solidity
address public treasury;

event TreasuryUpdated(address indexed newTreasury);
event TreasuryBuybackExecuted(
    uint256 indexed vaultId,
    address indexed treasury,
    address indexed lendingPool,
    uint256 debtPaid
);

error ZeroAddressTreasury();
error UnauthorizedTreasury(address caller);
error AuctionNotExpired(uint256 vaultId, uint256 currentTime, uint256 expiryTime);

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

### 2.3 `treasuryBuyback` Implementation

```solidity
function treasuryBuyback(uint256 vaultId, address lendingPool) external nonReentrant {
    if (msg.sender != treasury) {
        revert UnauthorizedTreasury(msg.sender);
    }

    Auction storage auction = auctions[vaultId];
    if (auction.startTime == 0 || auction.isSettled) {
        revert AuctionNotActive(vaultId);
    }
    if (!poolFactory.isValidPool(lendingPool)) {
        revert UnregisteredLendingPool(lendingPool);
    }

    uint256 expiryTime = auction.startTime + auction.duration;
    if (block.timestamp < expiryTime) {
        revert AuctionNotExpired(vaultId, block.timestamp, expiryTime);
    }

    uint256 debtPaid = auction.debtAmount;

    // CEI State Mutation
    auction.isSettled = true;

    IERC20 asset = IERC20(HoloFiLendingPool(lendingPool).asset());

    // Step 1: Pull debtPaid from Treasury to DutchAuction
    asset.safeTransferFrom(msg.sender, address(this), debtPaid);

    // Step 2: Approve & return loan debt to LendingPool
    asset.forceApprove(lendingPool, debtPaid);
    HoloFiLendingPool(lendingPool).returnLiquidity(address(this), debtPaid);

    // Step 3: Finalize liquidation status, unlock & transfer collateral NFTs to Treasury
    loanCore.finalizeLiquidation(vaultId, msg.sender);

    emit TreasuryBuybackExecuted(vaultId, msg.sender, lendingPool, debtPaid);
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. `test_SetTreasury_Success`: Admin updates `treasury` address -> emits `TreasuryUpdated`. Non-admin reverts `UnauthorizedAdmin`. Passing address(0) reverts `ZeroAddressTreasury`.
2. `test_RevertIf_TreasuryBuyback_UnauthorizedCaller`: Non-treasury caller attempts `treasuryBuyback` -> reverts `UnauthorizedTreasury`.
3. `test_RevertIf_TreasuryBuyback_NotExpired`: Calling `treasuryBuyback` before 48h expiration (`block.timestamp < startTime + duration`) -> reverts `AuctionNotExpired`.
4. `test_TreasuryBuyback_Success`: Auction expires past 48h. Treasury approves `dutchAuction` for `debtAmount` ($4,000) and calls `treasuryBuyback`.
   - Asserts `returnLiquidity` receives $4,000 debt payoff.
   - Asserts pool debt is 100% cleared ($0 debt remaining).
   - Asserts card NFTs are transferred to `treasury` address (`ownerOf(cardId) == treasury`).
   - Asserts `TreasuryBuybackExecuted` event is emitted.

### 3.2 TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)
1. Update `test/HoloFiDutchAuction.ts`:
   - Set up treasury account and register via `dutchAuction.connect(admin).setTreasury(treasury.address)`.
   - Start auction, time warp 49 hours past expiration.
   - Treasury approves asset and calls `treasuryBuyback`.
   - Verify pool balance is restored to initial $100,000 EURC.
   - Verify treasury receives unlocked card NFTs.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
