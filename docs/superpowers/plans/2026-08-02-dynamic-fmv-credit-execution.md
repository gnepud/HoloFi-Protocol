# Dynamic FMV Integration & Credit Execution (`HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Chainlink / CRE oracle card FMV pricing integration and credit borrow execution in `HoloFiVaultLoanCore.sol`.

**Architecture:** Extend `HoloFiVaultLoanCore.sol` with card FMV state mapping (`cardFmv`), oracle FMV update functions (`setCardFmv`, `setBatchCardFmv`), vault FMV aggregator (`getVaultFMV`), and credit execution function (`borrow`). The `borrow` function enforces caller ownership, interest accrual guard, LTV max borrow capacity validation, debt accounting update, and liquidity drawdown from `HoloFiLendingPool`. Tested via Solidity unit tests (`contracts/HoloFiVaultLoanCore.t.sol`) and TypeScript integration tests (`test/HoloFiVaultLoanCore.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Oracle FMV & Credit Borrow Execution in `HoloFiVaultLoanCore.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: `setCardFmv`, `setBatchCardFmv`, `getVaultFMV`, `borrow`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiVaultLoanCore.t.sol`)**

Add unit tests to `contracts/HoloFiVaultLoanCore.t.sol`:

```solidity
    address public oracle = address(0x5555);

    // In setUp():
    // acm.grantRole(acm.ORACLE_ROLE(), oracle);

    function test_SetCardFmv_Success() public {
        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);
        assertEq(loanCore.cardFmv(cardId1), 5_000 * 1e6);
    }

    function test_SetBatchCardFmv_Success() public {
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        uint256[] memory fmvs = new uint256[](2);
        fmvs[0] = 6_000 * 1e6;
        fmvs[1] = 4_000 * 1e6;

        vm.prank(oracle);
        loanCore.setBatchCardFmv(tokenIds, fmvs);

        assertEq(loanCore.cardFmv(cardId1), 6_000 * 1e6);
        assertEq(loanCore.cardFmv(cardId2), 4_000 * 1e6);
    }

    function test_RevertIf_SetCardFmv_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnauthorizedOracle.selector, unauthorized));
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);
    }

    function test_GetVaultFMV() public {
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

        assertEq(loanCore.getVaultFMV(vaultId), 10_000 * 1e6);
    }

    function test_Borrow_Success() public {
        // Setup pool, deposit collateral, set FMV = $10,000, borrow $4,000
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        // Deploy pool & add liquidity
        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        HoloFiLendingPool pool = new HoloFiLendingPool(asset, "Pool EURC", "pEURC", address(acm));
        
        vm.prank(admin);
        pool.setLoanCore(address(loanCore));

        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 4_000 * 1e6);
        assertEq(asset.balanceOf(store), 4_000 * 1e6);
    }

    function test_RevertIf_Borrow_ExceedsMaxBorrowCapacity() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6); // Max borrow = 50% = $5,000

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        HoloFiLendingPool pool = new HoloFiLendingPool(asset, "Pool EURC", "pEURC", address(acm));

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.ExceedsMaxBorrowCapacity.selector,
                vaultId,
                6_000 * 1e6,
                5_000 * 1e6
            )
        );
        loanCore.borrow(vaultId, 6_000 * 1e6, address(pool));
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing FMV and borrow functions in `HoloFiVaultLoanCore.sol`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol` Implementation**

Update `contracts/HoloFiVaultLoanCore.sol`:

```solidity
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";

// Add state mapping:
mapping(uint256 => uint256) public cardFmv;

// Add events & errors:
event CardFmvUpdated(uint256 indexed tokenId, uint256 fmv);
event BorrowExecuted(
    uint256 indexed vaultId,
    address indexed owner,
    address indexed lendingPool,
    uint256 amount,
    uint256 newPrincipalDebt
);

error UnauthorizedOracle(address caller);
error ZeroBorrowAmount();
error ExceedsMaxBorrowCapacity(uint256 vaultId, uint256 requestedTotalDebt, uint256 maxBorrowCapacity);
error ArrayLengthMismatch();

// Implement functions:
function setCardFmv(uint256 tokenId, uint256 fmv) external {
    if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
        revert UnauthorizedOracle(msg.sender);
    }
    cardFmv[tokenId] = fmv;
    emit CardFmvUpdated(tokenId, fmv);
}

function setBatchCardFmv(uint256[] calldata tokenIds, uint256[] calldata fmvs) external {
    if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
        revert UnauthorizedOracle(msg.sender);
    }
    if (tokenIds.length != fmvs.length) {
        revert ArrayLengthMismatch();
    }
    for (uint256 i = 0; i < tokenIds.length; i++) {
        cardFmv[tokenIds[i]] = fmvs[i];
        emit CardFmvUpdated(tokenIds[i], fmvs[i]);
    }
}

function getVaultFMV(uint256 vaultId) public view returns (uint256 totalFmv) {
    uint256[] memory tokenIds = vaults[vaultId].tokenIds;
    for (uint256 i = 0; i < tokenIds.length; i++) {
        totalFmv += cardFmv[tokenIds[i]];
    }
}

function borrow(uint256 vaultId, uint256 amount, address lendingPool) external {
    CollateralVault storage vault = vaults[vaultId];
    if (msg.sender != vault.owner) {
        revert UnauthorizedVaultOwner(vaultId, msg.sender);
    }
    if (vault.status != VaultStatus.Active) {
        revert VaultNotActive(vaultId);
    }
    if (amount == 0) {
        revert ZeroBorrowAmount();
    }

    accrueInterest(vaultId);

    uint256 vaultFmv = getVaultFMV(vaultId);
    uint256 maxBorrow = getMaxBorrowCapacity(vaultFmv);
    uint256 newTotalDebt = getTotalDebt(vaultId) + amount;

    if (newTotalDebt > maxBorrow) {
        revert ExceedsMaxBorrowCapacity(vaultId, newTotalDebt, maxBorrow);
    }

    vault.principalDebt += amount;

    HoloFiLendingPool(lendingPool).drawLiquidity(vault.owner, amount);

    emit BorrowExecuted(vaultId, vault.owner, lendingPool, amount, vault.principalDebt);
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (71 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-22): implement dynamic FMV oracle integration and credit borrow execution (relates to HF-22)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)

**Files:**
- Modify: `test/HoloFiVaultLoanCore.ts`

**Interfaces:**
- Consumes: `setBatchCardFmv`, `getVaultFMV`, `borrow`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)**

Add integration tests to `test/HoloFiVaultLoanCore.ts`:

```ts
  it("Should allow oracle to set card FMVs, calculate vault FMV, and execute borrow from lending pool", async function () {
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

    expect(await loanCore.getVaultFMV(1n)).to.equal(ethers.parseUnits("10000", 6));

    await expect(loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), await pool.getAddress()))
      .to.emit(loanCore, "BorrowExecuted")
      .withArgs(1n, store.address, await pool.getAddress(), ethers.parseUnits("4000", 6), ethers.parseUnits("4000", 6));

    expect(await asset.balanceOf(store.address)).to.equal(ethers.parseUnits("4000", 6));

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.equal(ethers.parseUnits("4000", 6));

    await expect(
      loanCore.connect(store).borrow(1n, ethers.parseUnits("2000", 6), await pool.getAddress())
    ).to.be.revertedWithCustomError(loanCore, "ExceedsMaxBorrowCapacity");
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (91 total tests: 63 Solidity + 28 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiVaultLoanCore.ts
git commit -m "test(HF-22): add TypeScript integration tests for dynamic FMV and borrow execution (Fixes HF-22)"
```
