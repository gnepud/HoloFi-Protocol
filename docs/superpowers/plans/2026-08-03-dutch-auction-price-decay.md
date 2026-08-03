# Dutch Auction Price Decay Algorithm (`HoloFiDutchAuction`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement auction initiation logic (`startAuction`) with $HF < 1.0$ validation in `HoloFiVaultLoanCore.sol` and the continuous 48-hour linear price decay algorithm (`getAuctionPrice`) in `HoloFiDutchAuction.sol`.

**Architecture:** Extend `HoloFiVaultLoanCore.sol` with `startLiquidation(uint256 vaultId)` restricting caller to `dutchAuction`, accruing interest, checking $HF < 1.0$, and updating status to `Liquidating`. Extend `HoloFiDutchAuction.sol` with basis points constants (`START_PRICE_BPS = 12000`, `BPS_DENOMINATOR = 10000`), `startAuction(vaultId)` setting start price at 120% FMV and reserve price at total debt, and `getAuctionPrice(vaultId)` calculating linear price decay over 48 hours down to total debt. Tested via Solidity unit tests (`contracts/HoloFiDutchAuction.t.sol`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `startLiquidation`, `startAuction`, `getAuctionPrice` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`
- Modify: `contracts/HoloFiDutchAuction.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: `startLiquidation` on LoanCore, `startAuction` and `getAuctionPrice` on `HoloFiDutchAuction`.

- [ ] **Step 1: Write Solidity Unit Test Additions (`contracts/HoloFiDutchAuction.t.sol`)**

Add unit tests to `contracts/HoloFiDutchAuction.t.sol`:

```solidity
    function test_StartAuction_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (FMV $10,000, max borrow $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Oracle drops FMV of cardId1 from $10,000 to $5,000
        // Debt = $4,000, Liquidation threshold = 70% -> max threshold value = $3,500. HF = 3,500 / 4,000 = 0.875 < 1.0
        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        HoloFiDutchAuction.Auction memory auction = dutchAuction.getAuction(vaultId);
        assertEq(auction.startFmv, 5_000 * 1e6);
        assertEq(auction.startPrice, 6_000 * 1e6); // 120% of $5,000
        assertEq(auction.reservePrice, 4_000 * 1e6); // total debt $4,000
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Liquidating));
    }

    function test_RevertIf_StartAuction_HealthyVault() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // HF = (10,000 * 0.7) / 4,000 = 1.75 >= 1.0 -> revert VaultNotEligibleForLiquidation
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.VaultNotEligibleForLiquidation.selector,
                vaultId,
                1750000000000000000
            )
        );
        dutchAuction.startAuction(vaultId);
    }

    function test_GetAuctionPrice_LinearDecay() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // t = 0 -> startPrice $6,000
        assertEq(dutchAuction.getAuctionPrice(vaultId), 6_000 * 1e6);

        // t = 24h (midpoint) -> midpoint between $6,000 and $4,000 is $5,000
        vm.warp(block.timestamp + 24 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 5_000 * 1e6);

        // t = 48h (duration end) -> reservePrice $4,000
        vm.warp(block.timestamp + 24 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 4_000 * 1e6);

        // t = 60h (> duration end) -> reservePrice $4,000
        vm.warp(block.timestamp + 12 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 4_000 * 1e6);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `startLiquidation`, `startAuction`, and `getAuctionPrice`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol` and `contracts/HoloFiDutchAuction.sol`**

In `contracts/HoloFiVaultLoanCore.sol`:

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

In `contracts/HoloFiDutchAuction.sol`:

```solidity
uint256 public constant BPS_DENOMINATOR = 10000;
uint256 public constant START_PRICE_BPS = 12000; // 120.00%

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

function getAuction(uint256 vaultId) external view returns (Auction memory) {
    return auctions[vaultId];
}
```

- [ ] **Step 4: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (126 total tests: 93 Solidity + 33 Mocha).

- [ ] **Step 5: Commit Task 1 with Linear Magic Word**

```bash
git add contracts/HoloFiDutchAuction.sol contracts/HoloFiDutchAuction.t.sol contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-26): implement Dutch Auction startAuction and getAuctionPrice linear decay (Fixes HF-26)"
```
