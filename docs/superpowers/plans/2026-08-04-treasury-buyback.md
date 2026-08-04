# Protocol Treasury Buyback & Unsold Auction Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `treasury` role configuration and `treasuryBuyback(vaultId, lendingPool)` in `HoloFiDutchAuction.sol` to allow the Protocol Treasury to buy back unsold auctions after the 48-hour duration expired.

**Architecture:** Extend `HoloFiDutchAuction.sol` with `address public treasury;`, `setTreasury(address _treasury)` (`ADMIN_ROLE` restricted), and `treasuryBuyback(uint256 vaultId, address lendingPool)` (`nonReentrant`). Validates `msg.sender == treasury`, `block.timestamp >= auction.startTime + auction.duration`, pulls `debtAmount` from `treasury` into `address(this)`, clears 100% of loan debt via `returnLiquidity(address(this), debtAmount)` (waiving the 10% penalty surcharge), and finalizes liquidation via `loanCore.finalizeLiquidation(vaultId, msg.sender)` to transfer collateral card NFTs to the Treasury wallet. Tested via Solidity unit tests (`contracts/HoloFiDutchAuction.t.sol`) and TypeScript integration tests (`test/HoloFiDutchAuction.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `setTreasury`, `treasuryBuyback` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiDutchAuction.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: `treasury` state variable, `setTreasury`, `treasuryBuyback`, `UnauthorizedTreasury`, `AuctionNotExpired`, `TreasuryBuybackExecuted`.

- [ ] **Step 1: Write Solidity Unit Test Additions (`contracts/HoloFiDutchAuction.t.sol`)**

Add unit tests to `contracts/HoloFiDutchAuction.t.sol`:

```solidity
    function test_SetTreasury_Success() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);
        assertEq(dutchAuction.treasury(), treasury);
    }

    function test_RevertIf_SetTreasury_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.UnauthorizedAdmin.selector, unauthorized));
        dutchAuction.setTreasury(address(0x5555));
    }

    function test_RevertIf_SetTreasury_ZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressTreasury.selector));
        dutchAuction.setTreasury(address(0));
    }

    function test_RevertIf_TreasuryBuyback_UnauthorizedCaller() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.UnauthorizedTreasury.selector, unauthorized));
        dutchAuction.treasuryBuyback(1, address(0x1234));
    }

    function test_RevertIf_TreasuryBuyback_NotExpired() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);

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

        // Time warp 24h (only half duration)
        vm.warp(block.timestamp + 24 hours);

        vm.prank(treasury);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiDutchAuction.AuctionNotExpired.selector,
                vaultId,
                block.timestamp,
                block.timestamp + 24 hours
            )
        );
        dutchAuction.treasuryBuyback(vaultId, address(pool));
    }

    function test_TreasuryBuyback_Success() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);

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

        // Time warp 49h (past 48h expiration)
        vm.warp(block.timestamp + 49 hours);

        asset.mint(treasury, 4_000 * 1e6);

        vm.startPrank(treasury);
        asset.approve(address(dutchAuction), 4_000 * 1e6);

        dutchAuction.treasuryBuyback(vaultId, address(pool));
        vm.stopPrank();

        // Assertions
        assertEq(asset.balanceOf(address(pool)), 100_000 * 1e6); // Exact $4,000 debt restored
        assertEq(cardCollection.ownerOf(cardId1), treasury); // Card NFT assigned to treasury
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Liquidated));
        assertEq(loanCore.getVault(vaultId).principalDebt, 0);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `setTreasury` and `treasuryBuyback`.

- [ ] **Step 3: Update `contracts/HoloFiDutchAuction.sol`**

In `contracts/HoloFiDutchAuction.sol`:

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

    auction.isSettled = true;

    IERC20 asset = IERC20(HoloFiLendingPool(lendingPool).asset());

    // Step 1: Pull exact debtPaid from treasury to DutchAuction
    asset.safeTransferFrom(msg.sender, address(this), debtPaid);

    // Step 2: Approve & return debt to LendingPool
    asset.forceApprove(lendingPool, debtPaid);
    HoloFiLendingPool(lendingPool).returnLiquidity(address(this), debtPaid);

    // Step 3: Finalize liquidation & transfer collateral NFTs to treasury
    loanCore.finalizeLiquidation(vaultId, msg.sender);

    emit TreasuryBuybackExecuted(vaultId, msg.sender, lendingPool, debtPaid);
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (103 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiDutchAuction.sol contracts/HoloFiDutchAuction.t.sol
git commit -m "feat(HF-33): implement setTreasury and treasuryBuyback for expired auctions (relates to HF-33)"
```

---

### Task 2: Update TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)

**Files:**
- Modify: `test/HoloFiDutchAuction.ts`

**Interfaces:**
- Consumes: `setTreasury` and `treasuryBuyback`.

- [ ] **Step 1: Update TypeScript Integration Test (`test/HoloFiDutchAuction.ts`)**

Add integration test case in `test/HoloFiDutchAuction.ts`:

```ts
  it("Should allow treasury to execute buyback for expired unsold auction, restoring pool principal and assigning card NFTs", async function () {
    const { loanCore, cardCollection, dutchAuction, poolFactory, acm, admin, store, minter, liquidator, unauthorized } = await networkHelpers.loadFixture(deployDutchAuctionFixture);

    const [,,,,, treasury] = await ethers.getSigners();
    await dutchAuction.connect(admin).setTreasury(treasury.address);
    expect(await dutchAuction.treasury()).to.equal(treasury.address);

    const asset = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    await poolFactory.connect(admin).createPool(await asset.getAddress(), "Pool EURC", "pEURC");
    const poolAddr = await poolFactory.getPool(await asset.getAddress());
    const pool = await ethers.getContractAt("HoloFiLendingPool", poolAddr);

    await pool.connect(admin).setLoanCore(await loanCore.getAddress());
    await asset.mint(poolAddr, ethers.parseUnits("100000", 6));

    await loanCore.connect(store).createVault();
    await cardCollection.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await loanCore.connect(minter).setBatchCardFmv(
      [1n, 2n],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    await loanCore.connect(admin).setRiskParameters(5000n, 7000n, 1000n, 0n);
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    // Drop FMV so HF < 1.0
    await loanCore.connect(minter).setBatchCardFmv(
      [1n, 2n],
      [ethers.parseUnits("1000", 6), ethers.parseUnits("4000", 6)]
    );

    const auctionAddr = await dutchAuction.getAddress();
    await dutchAuction.connect(liquidator).startAuction(1n);

    // Attempt premature buyback before 48h expiration -> revert AuctionNotExpired
    await expect(dutchAuction.connect(treasury).treasuryBuyback(1n, poolAddr))
      .to.be.revertedWithCustomError(dutchAuction, "AuctionNotExpired");

    // Attempt buyback by unauthorized caller -> revert UnauthorizedTreasury
    await networkHelpers.time.increase(49 * 3600);
    await expect(dutchAuction.connect(unauthorized).treasuryBuyback(1n, poolAddr))
      .to.be.revertedWithCustomError(dutchAuction, "UnauthorizedTreasury");

    // Treasury executes buyback
    await asset.mint(treasury.address, ethers.parseUnits("4000", 6));
    await asset.connect(treasury).approve(auctionAddr, ethers.parseUnits("4000", 6));

    await expect(dutchAuction.connect(treasury).treasuryBuyback(1n, poolAddr))
      .to.emit(dutchAuction, "TreasuryBuybackExecuted")
      .withArgs(1n, treasury.address, poolAddr, ethers.parseUnits("4000", 6));

    // Verify lending pool balance is restored to 100,000 EURC (no penalty added)
    expect(await asset.balanceOf(poolAddr)).to.equal(ethers.parseUnits("100000", 6));

    // Verify treasury owns card NFTs
    expect(await cardCollection.ownerOf(1n)).to.equal(treasury.address);
    expect(await cardCollection.ownerOf(2n)).to.equal(treasury.address);

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.status).to.equal(3n); // VaultStatus.Liquidated
    expect(vaultInfo.principalDebt).to.equal(0n);
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (137 total tests: 103 Solidity + 34 Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiDutchAuction.ts
git commit -m "test(HF-33): add TypeScript integration tests for protocol treasury buyback (Fixes HF-33)"
```
