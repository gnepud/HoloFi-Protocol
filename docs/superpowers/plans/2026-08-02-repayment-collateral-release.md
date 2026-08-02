# Card Loan Repayment & Full Collateral Release (`HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement loan repayment logic (`repay`) with interest-first waterfall allocation, liquidity return to `HoloFiLendingPool`, and full collateral release capability in `HoloFiVaultLoanCore.sol`.

**Architecture:** Extend `HoloFiVaultLoanCore.sol` with `repay(vaultId, amount, lendingPool)`. The function triggers pre-execution interest accrual, caps repayment at total debt, applies interest-first waterfall debt reduction, calls `returnLiquidity` on `HoloFiLendingPool`, and enables complete NFT collateral withdrawal via `withdrawCollateral` once debt is 0. Tested via Solidity unit tests (`contracts/HoloFiVaultLoanCore.t.sol`) and TypeScript integration tests (`test/HoloFiVaultLoanCore.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Repayment Logic in `HoloFiVaultLoanCore.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: `repay`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiVaultLoanCore.t.sol`)**

Add unit tests to `contracts/HoloFiVaultLoanCore.t.sol`:

```solidity
    function test_Repay_PartialInterestAndPrincipal() public {
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
        HoloFiLendingPool pool = new HoloFiLendingPool(asset, "Pool EURC", "pEURC", address(acm));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));

        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Warp 1 year -> $200 interest accrued (5% of 4,000)
        vm.warp(block.timestamp + 365 days);

        // Mint asset to store to repay $1,200 ($200 interest + $1,000 principal)
        asset.mint(store, 1_200 * 1e6);

        vm.startPrank(store);
        asset.approve(address(pool), 1_200 * 1e6);
        loanCore.repay(vaultId, 1_200 * 1e6, address(pool));
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.accumulatedInterest, 0);
        assertEq(vault.principalDebt, 3_000 * 1e6);
    }

    function test_Repay_FullLoanSettlementAndCollateralRelease() public {
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
        HoloFiLendingPool pool = new HoloFiLendingPool(asset, "Pool EURC", "pEURC", address(acm));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));

        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.warp(block.timestamp + 365 days); // $200 interest accrued

        // Repay $5,000 (total debt = $4,200, overpayment capped at $4,200)
        asset.mint(store, 5_000 * 1e6);

        vm.startPrank(store);
        asset.approve(address(pool), 5_000 * 1e6);
        loanCore.repay(vaultId, 5_000 * 1e6, address(pool));
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 0);
        assertEq(vault.accumulatedInterest, 0);

        // Withdraw collateral back to store
        vm.prank(store);
        loanCore.withdrawCollateral(vaultId, tokenIds);

        assertEq(cardCollection.ownerOf(cardId1), store);
    }

    function test_RevertIf_Repay_ZeroAmount() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        HoloFiLendingPool pool = new HoloFiLendingPool(asset, "Pool EURC", "pEURC", address(acm));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroRepayAmount.selector));
        loanCore.repay(vaultId, 0, address(pool));
    }

    function test_RevertIf_Repay_NoActiveDebt() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        HoloFiLendingPool pool = new HoloFiLendingPool(asset, "Pool EURC", "pEURC", address(acm));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.NoActiveDebt.selector, vaultId));
        loanCore.repay(vaultId, 1_000 * 1e6, address(pool));
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `repay` function in `HoloFiVaultLoanCore.sol`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol` Implementation**

Update `contracts/HoloFiVaultLoanCore.sol`:

```solidity
// Add events & errors:
event RepaymentExecuted(
    uint256 indexed vaultId,
    address indexed payer,
    address indexed lendingPool,
    uint256 totalRepaid,
    uint256 interestPaid,
    uint256 principalPaid,
    uint256 remainingPrincipalDebt,
    uint256 remainingAccumulatedInterest
);

error ZeroRepayAmount();
error NoActiveDebt(uint256 vaultId);

// Implement function:
function repay(uint256 vaultId, uint256 amount, address lendingPool) external {
    CollateralVault storage vault = vaults[vaultId];
    if (vault.status != VaultStatus.Active) {
        revert VaultNotActive(vaultId);
    }
    if (amount == 0) {
        revert ZeroRepayAmount();
    }

    accrueInterest(vaultId);

    uint256 totalDebt = vault.accumulatedInterest + vault.principalDebt;
    if (totalDebt == 0) {
        revert NoActiveDebt(vaultId);
    }

    uint256 actualRepay = amount > totalDebt ? totalDebt : amount;
    uint256 interestPaid;
    uint256 principalPaid;

    if (actualRepay <= vault.accumulatedInterest) {
        vault.accumulatedInterest -= actualRepay;
        interestPaid = actualRepay;
    } else {
        interestPaid = vault.accumulatedInterest;
        principalPaid = actualRepay - interestPaid;
        vault.accumulatedInterest = 0;
        vault.principalDebt -= principalPaid;
    }

    HoloFiLendingPool(lendingPool).returnLiquidity(msg.sender, actualRepay);

    emit RepaymentExecuted(
        vaultId,
        msg.sender,
        lendingPool,
        actualRepay,
        interestPaid,
        principalPaid,
        vault.principalDebt,
        vault.accumulatedInterest
    );
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (76 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-23): implement loan repayment and collateral release enablement (relates to HF-23)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)

**Files:**
- Modify: `test/HoloFiVaultLoanCore.ts`

**Interfaces:**
- Consumes: `repay`, `withdrawCollateral`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)**

Add integration tests to `test/HoloFiVaultLoanCore.ts`:

```ts
  it("Should allow store to execute full loan repayment and release collateral NFTs", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

    const asset = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const pool = await ethers.deployContract("HoloFiLendingPool", [
      await asset.getAddress(),
      "Pool EURC",
      "pEURC",
      await acm.getAddress(),
    ]);

    await pool.connect(admin).setLoanCore(await loanCore.getAddress());
    await asset.mint(await pool.getAddress(), ethers.parseUnits("100000", 6));

    await loanCore.connect(store).createVault();
    await cardCollection.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await loanCore.connect(minter).setBatchCardFmv(
      [1n, 2n],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    const poolAddr = await pool.getAddress();
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    await networkHelpers.time.increase(86400 * 365); // 1 year -> 5% interest ($200)

    const totalDebt = await loanCore.getTotalDebt(1n);
    expect(totalDebt).to.equal(ethers.parseUnits("4200", 6));

    await asset.mint(store.address, ethers.parseUnits("200", 6));
    await asset.connect(store).approve(poolAddr, totalDebt);

    await expect(loanCore.connect(store).repay(1n, totalDebt, poolAddr))
      .to.emit(loanCore, "RepaymentExecuted")
      .withArgs(
        1n,
        store.address,
        poolAddr,
        totalDebt,
        ethers.parseUnits("200", 6),
        ethers.parseUnits("4000", 6),
        0n,
        0n
      );

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.equal(0n);
    expect(vaultInfo.accumulatedInterest).to.equal(0n);

    await loanCore.connect(store).withdrawCollateral(1n, [1n, 2n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(store.address);
    expect(await cardCollection.ownerOf(2n)).to.equal(store.address);
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (101 total tests: 72 Solidity + 29 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiVaultLoanCore.ts
git commit -m "test(HF-23): add TypeScript integration tests for repayment and full collateral release (Fixes HF-23)"
```
