# Partial Repayment & Flexible Collateral Release (`HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement LTV-guarded flexible collateral withdrawal (`withdrawCollateral`) and atomic debt repayment with collateral release (`repayAndWithdraw`) in `HoloFiVaultLoanCore.sol`.

**Architecture:** Extend `HoloFiVaultLoanCore.sol` to allow partial NFT collateral withdrawals while active debt exists, provided the remaining vault FMV satisfies `getTotalDebt(vaultId) <= getMaxBorrowCapacity(remainingFmv)` (reverting `InsufficientCollateralRatio` if breached). Implement `repayAndWithdraw(vaultId, repayAmount, lendingPool, withdrawTokenIds)` with explicit entry caller authorization checks when withdrawing. Tested via Solidity unit tests (`contracts/HoloFiVaultLoanCore.t.sol`) and TypeScript integration tests (`test/HoloFiVaultLoanCore.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Flexible Collateral Release & `repayAndWithdraw` in `HoloFiVaultLoanCore.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: Enhanced `withdrawCollateral`, `repayAndWithdraw`, `InsufficientCollateralRatio` error.

- [ ] **Step 1: Write Solidity Unit Test Additions**

Add unit tests to `contracts/HoloFiVaultLoanCore.t.sol`:

```solidity
    function test_WithdrawCollateral_PartialExcessCollateral() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $3,000 (total FMV = $10,000, max borrow = $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 3_000 * 1e6, address(pool));

        // Withdraw cardId2 ($4,000 FMV). Remaining FMV = $6,000 (max borrow = $3,000). Debt = $3,000 -> succeeds
        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId2;

        vm.prank(store);
        loanCore.withdrawCollateral(vaultId, withdrawTokens);

        assertEq(cardCollection.ownerOf(cardId2), store);
    }

    function test_RevertIf_WithdrawCollateral_InsufficientCollateralRatio() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (total FMV = $10,000, max borrow = $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Attempt to withdraw cardId1 ($6,000 FMV). Remaining FMV = $4,000 (max borrow = $2,000). Debt = $4,000 -> reverts
        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.InsufficientCollateralRatio.selector,
                vaultId,
                4_000 * 1e6,
                2_000 * 1e6
            )
        );
        loanCore.withdrawCollateral(vaultId, withdrawTokens);
    }

    function test_RepayAndWithdraw_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        asset.mint(store, 2_000 * 1e6);

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.startPrank(store);
        asset.approve(address(pool), 2_000 * 1e6);
        loanCore.repayAndWithdraw(vaultId, 2_000 * 1e6, address(pool), withdrawTokens);
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 2_000 * 1e6);
        assertEq(cardCollection.ownerOf(cardId1), store);
    }

    function test_RevertIf_RepayAndWithdraw_Unauthorized() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.repayAndWithdraw(vaultId, 0, address(0), withdrawTokens);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to strict zero-debt requirement in `withdrawCollateral` and missing `repayAndWithdraw`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol` Implementation**

Update `contracts/HoloFiVaultLoanCore.sol`:

```solidity
error InsufficientCollateralRatio(uint256 vaultId, uint256 totalDebt, uint256 remainingMaxBorrow);

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

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (85 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-31): implement flexible collateral release and atomic repayAndWithdraw (relates to HF-31)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)

**Files:**
- Modify: `test/HoloFiVaultLoanCore.ts`

**Interfaces:**
- Consumes: `withdrawCollateral` (partial), `repayAndWithdraw`, `InsufficientCollateralRatio`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)**

Add integration tests to `test/HoloFiVaultLoanCore.ts`:

```ts
  it("Should allow store to withdraw excess collateral when remaining FMV satisfies LTV ratio", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

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

    // Borrow $3,000 (total FMV = $10,000, max borrow = $5,000)
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("3000", 6), poolAddr);

    // Attempt to withdraw card 1 ($6,000 FMV). Remaining FMV = $4,000 (max borrow = $2,000). Debt = $3,000 -> reverts
    await expect(
      loanCore.connect(store).withdrawCollateral(1n, [1n])
    ).to.be.revertedWithCustomError(loanCore, "InsufficientCollateralRatio");

    // Withdraw card 2 ($4,000 FMV). Remaining FMV = $6,000 (max borrow = $3,000). Debt = $3,000 -> succeeds
    await loanCore.connect(store).withdrawCollateral(1n, [2n]);

    expect(await cardCollection.ownerOf(2n)).to.equal(store.address);
  });

  it("Should allow store to execute atomic repayAndWithdraw to reduce debt and free collateral", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

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

    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    await asset.mint(store.address, ethers.parseUnits("2000", 6));
    await asset.connect(store).approve(poolAddr, ethers.parseUnits("2000", 6));

    // Repay $2,000 and withdraw card 1 ($6,000 FMV). Remaining debt = $2,000, remaining FMV = $4,000 (max borrow = $2,000) -> succeeds
    await loanCore.connect(store).repayAndWithdraw(1n, ethers.parseUnits("2000", 6), poolAddr, [1n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(store.address);

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.equal(ethers.parseUnits("2000", 6));
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (114 total tests: 85 Solidity + 29 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiVaultLoanCore.ts
git commit -m "test(HF-31): add TypeScript integration tests for partial repay and flexible release (Fixes HF-31)"
```
