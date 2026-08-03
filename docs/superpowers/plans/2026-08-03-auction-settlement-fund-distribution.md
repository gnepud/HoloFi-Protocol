# Auction Settlement & Fund Distribution (`HoloFiDutchAuction`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement auction settlement (`settleAuction`) in `HoloFiDutchAuction.sol` and collateral transfer finalization (`finalizeLiquidation`) in `HoloFiVaultLoanCore.sol`.

**Architecture:** Extend `HoloFiVaultLoanCore.sol` with `finalizeLiquidation(uint256 vaultId, address liquidator)` to reset debt, mark vault `Liquidated`, unlock cards, and transfer NFTs to liquidator. Extend `HoloFiDutchAuction.sol` with `settleAuction(uint256 vaultId, address lendingPool)` to pay pool debt via `returnLiquidity`, refund surplus asset tokens to the defaulting store, and finalize liquidation on `LoanCore`. Tested via Solidity unit tests (`contracts/HoloFiDutchAuction.t.sol`) and TypeScript integration tests (`test/HoloFiDutchAuction.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `finalizeLiquidation` & `settleAuction` in Contracts & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`
- Modify: `contracts/HoloFiDutchAuction.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: `finalizeLiquidation` on LoanCore, `settleAuction` on `HoloFiDutchAuction`.

- [ ] **Step 1: Write Solidity Unit Test Additions (`contracts/HoloFiDutchAuction.t.sol`)**

Add unit tests to `contracts/HoloFiDutchAuction.t.sol`:

```solidity
    function test_SettleAuction_WithSurplus() public {
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

        // Borrow $4,000 (total FMV = $10,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Drop FMV to $5,000 -> HF = 3,500 / 4,000 = 0.875 < 1.0
        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // StartPrice = $6,000, ReservePrice = $4,000. Time warp 24h -> CurrentPrice = $5,000 (debt = $4,000, surplus = $1,000)
        vm.warp(block.timestamp + 24 hours);

        address liquidator = address(0x8888);
        asset.mint(liquidator, 6_000 * 1e6);

        vm.startPrank(liquidator);
        asset.approve(address(pool), 4_000 * 1e6);
        asset.approve(address(dutchAuction), 1_000 * 1e6);

        dutchAuction.settleAuction(vaultId, address(pool));
        vm.stopPrank();

        // Verifications
        assertEq(asset.balanceOf(store), 1_000 * 1e6); // Store receives $1,000 surplus
        assertEq(cardCollection.ownerOf(cardId1), liquidator); // Liquidator receives card NFT
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Liquidated));
        assertEq(loanCore.getVault(vaultId).principalDebt, 0);
    }

    function test_SettleAuction_AtReservePrice() public {
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

        // Time warp 48h -> CurrentPrice = ReservePrice = $4,000 (surplus = 0)
        vm.warp(block.timestamp + 48 hours);

        address liquidator = address(0x8888);
        asset.mint(liquidator, 4_000 * 1e6);

        vm.startPrank(liquidator);
        asset.approve(address(pool), 4_000 * 1e6);

        dutchAuction.settleAuction(vaultId, address(pool));
        vm.stopPrank();

        assertEq(asset.balanceOf(store), 0);
        assertEq(cardCollection.ownerOf(cardId1), liquidator);
    }

    function test_RevertIf_SettleAuction_UnregisteredPool() public {
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

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.UnregisteredLendingPool.selector, unauthorized));
        dutchAuction.settleAuction(vaultId, unauthorized);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `finalizeLiquidation` and `settleAuction`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol` and `contracts/HoloFiDutchAuction.sol`**

In `contracts/HoloFiVaultLoanCore.sol`:

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

In `contracts/HoloFiDutchAuction.sol`:

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

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (95 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiDutchAuction.sol contracts/HoloFiDutchAuction.t.sol contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-27): implement settleAuction and finalizeLiquidation integration (relates to HF-27)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiDutchAuction.ts`)

**Files:**
- Create: `test/HoloFiDutchAuction.ts`

**Interfaces:**
- Consumes: `startAuction`, `getAuctionPrice`, `settleAuction`.

- [ ] **Step 1: Write TypeScript Integration Test Suite (`test/HoloFiDutchAuction.ts`)**

Create `test/HoloFiDutchAuction.ts`:

```ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiDutchAuction Integration Tests", function () {
  async function deployDutchAuctionFixture() {
    const [owner, admin, minter, store, liquidator, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const cardCollection = await ethers.deployContract("HoloFiCardCollection", [
      "HoloFi TCG Cards",
      "HFC",
      await acm.getAddress(),
    ]);
    const poolFactory = await ethers.deployContract("HoloFiLendingPoolFactory", [await acm.getAddress()]);
    const loanCore = await ethers.deployContract("HoloFiVaultLoanCore", [
      await acm.getAddress(),
      await cardCollection.getAddress(),
      await poolFactory.getAddress(),
    ]);
    const dutchAuction = await ethers.deployContract("HoloFiDutchAuction", [
      await acm.getAddress(),
      await loanCore.getAddress(),
      await poolFactory.getAddress(),
    ]);

    const minterRole = await acm.MINTER_ROLE();
    const adminRole = await acm.ADMIN_ROLE();
    const oracleRole = await acm.ORACLE_ROLE();

    await acm.connect(admin).grantRole(minterRole, minter.address);
    await acm.connect(admin).grantRole(oracleRole, minter.address);
    await acm.connect(admin).grantRole(adminRole, await loanCore.getAddress());
    await acm.connect(admin).setKybStatus(store.address, true);

    await loanCore.connect(admin).setDutchAuction(await dutchAuction.getAddress());

    const attestationHash1 = ethers.keccak256(ethers.toUtf8Bytes("attestation_card_1"));
    const attestationHash2 = ethers.keccak256(ethers.toUtf8Bytes("attestation_card_2"));

    await cardCollection.connect(minter).mintCard(store.address, attestationHash1, "ipfs://card1");
    await cardCollection.connect(minter).mintCard(store.address, attestationHash2, "ipfs://card2");

    return { acm, cardCollection, poolFactory, loanCore, dutchAuction, owner, admin, minter, store, liquidator, unauthorized };
  }

  it("Should execute end-to-end liquidation, paying off pool debt, refunding store surplus, and transferring card NFTs", async function () {
    const { loanCore, cardCollection, dutchAuction, poolFactory, acm, admin, store, minter, liquidator } = await networkHelpers.loadFixture(deployDutchAuctionFixture);

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

    // Borrow $4,000 (total FMV = $10,000, max borrow = $5,000)
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    // Oracle drops card FMV so HF < 1.0 (card 1 dropped to $3,000, total FMV = $7,000. Threshold = $4,900. Debt = $4,000 -> HF = 4,900 / 4,000 = 1.225)
    // Drop card 1 FMV to $1,000 -> total FMV = $5,000. Threshold = $3,500. Debt = $4,000 -> HF = 0.875 < 1.0
    await loanCore.connect(minter).setBatchCardFmv(
      [1n, 2n],
      [ethers.parseUnits("1000", 6), ethers.parseUnits("4000", 6)]
    );

    const auctionAddr = await dutchAuction.getAddress();
    await expect(dutchAuction.connect(liquidator).startAuction(1n))
      .to.emit(dutchAuction, "AuctionStarted");

    // StartPrice = $6,000 (120% of $5,000), ReservePrice = $4,000 (total debt)
    // Time warp 24h -> CurrentPrice = $5,000 (debt = $4,000, surplus = $1,000)
    await networkHelpers.time.increase(86400);

    const currentPrice = await dutchAuction.getAuctionPrice(1n);
    expect(currentPrice).to.equal(ethers.parseUnits("5000", 6));

    await asset.mint(liquidator.address, ethers.parseUnits("6000", 6));
    await asset.connect(liquidator).approve(poolAddr, ethers.parseUnits("4000", 6));
    await asset.connect(liquidator).approve(auctionAddr, ethers.parseUnits("1000", 6));

    const initialStoreBalance = await asset.balanceOf(store.address);

    await expect(dutchAuction.connect(liquidator).settleAuction(1n, poolAddr))
      .to.emit(dutchAuction, "AuctionSettled")
      .withArgs(
        1n,
        liquidator.address,
        poolAddr,
        ethers.parseUnits("5000", 6),
        ethers.parseUnits("4000", 6),
        ethers.parseUnits("1000", 6)
      );

    // Verify store received $1,000 surplus
    const finalStoreBalance = await asset.balanceOf(store.address);
    expect(finalStoreBalance - initialStoreBalance).to.equal(ethers.parseUnits("1000", 6));

    // Verify pool asset balance restored
    expect(await asset.balanceOf(poolAddr)).to.equal(ethers.parseUnits("100000", 6));

    // Verify liquidator owns card NFTs
    expect(await cardCollection.ownerOf(1n)).to.equal(liquidator.address);
    expect(await cardCollection.ownerOf(2n)).to.equal(liquidator.address);

    const card1Info = await cardCollection.getCard(1n);
    const card2Info = await cardCollection.getCard(2n);
    expect(card1Info.isLocked).to.be.false;
    expect(card2Info.isLocked).to.be.false;

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.status).to.equal(3n); // VaultStatus.Liquidated
    expect(vaultInfo.principalDebt).to.equal(0n);
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (129 total tests: 95 Solidity + 34 Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiDutchAuction.ts
git commit -m "test(HF-27): add TypeScript integration tests for Dutch Auction settlement (Fixes HF-27)"
```
