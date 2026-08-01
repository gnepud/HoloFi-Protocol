# LTV, Interest Accrual & Risk Engine (`HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement protocol-wide risk parameters, linear interest accrual math over time, Health Factor calculations with 1e18 precision, and max borrow capacity engine in `HoloFiVaultLoanCore.sol`.

**Architecture:** Extend `HoloFiVaultLoanCore.sol` with risk state variables (`maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`), admin parameter setter (`setRiskParameters`), timestamp-based linear interest accrual (`accrueInterest`), and view calculation helpers (`getTotalDebt`, `calculateHealthFactor`, `getHealthFactor`, `getMaxBorrowCapacity`). Tested via Solidity unit tests (`contracts/HoloFiVaultLoanCore.t.sol`) and TypeScript integration tests (`test/HoloFiVaultLoanCore.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Risk Engine & Interest Accrual in `HoloFiVaultLoanCore.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: `setRiskParameters`, `accrueInterest`, `getPendingInterest`, `getTotalDebt`, `calculateHealthFactor`, `getHealthFactor`, `getMaxBorrowCapacity`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiVaultLoanCore.t.sol`)**

Add unit tests to `contracts/HoloFiVaultLoanCore.t.sol`:

```solidity
    function test_SetRiskParameters_Success() public {
        vm.prank(admin);
        loanCore.setRiskParameters(4000, 6000, 1500, 600);

        assertEq(loanCore.maxLtvBps(), 4000);
        assertEq(loanCore.liquidationThresholdBps(), 6000);
        assertEq(loanCore.liquidationPenaltyBps(), 1500);
        assertEq(loanCore.borrowRateBpsPerYear(), 600);
    }

    function test_RevertIf_SetRiskParameters_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnauthorizedAdmin.selector, unauthorized));
        loanCore.setRiskParameters(4000, 6000, 1500, 600);
    }

    function test_RevertIf_SetRiskParameters_InvalidParameters() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.InvalidRiskParameters.selector));
        loanCore.setRiskParameters(8000, 7000, 1000, 500); // LTV > Liquidation Threshold
    }

    function test_GetMaxBorrowCapacity() public view {
        uint256 fmv = 10_000 * 1e6; // $10,000 USDC
        uint256 maxBorrow = loanCore.getMaxBorrowCapacity(fmv);
        assertEq(maxBorrow, 5_000 * 1e6); // 50% LTV = $5,000 USDC
    }

    function test_CalculateHealthFactor_ZeroDebt() public view {
        uint256 hf = loanCore.calculateHealthFactor(10_000 * 1e6, 0);
        assertEq(hf, type(uint256).max);
    }

    function test_CalculateHealthFactor_AboveAndBelowOne() public view {
        uint256 fmv = 10_000 * 1e6;
        // Liquidation Threshold = 70% -> Max collateral value for HF=1.0 is $7,000

        // Safe debt = $5,000 -> HF = (10,000 * 0.7) / 5,000 = 1.4
        uint256 safeHf = loanCore.calculateHealthFactor(fmv, 5_000 * 1e6);
        assertEq(safeHf, 1.4e18);

        // Undercollateralized debt = $8,000 -> HF = (10,000 * 0.7) / 8,000 = 0.875
        uint256 unsafeHf = loanCore.calculateHealthFactor(fmv, 8_000 * 1e6);
        assertEq(unsafeHf, 0.875e18);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing risk engine methods in `HoloFiVaultLoanCore.sol`.

- [ ] **Step 3: Update `contracts/HoloFiVaultLoanCore.sol` Implementation**

Update `contracts/HoloFiVaultLoanCore.sol`:

```solidity
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant HEALTH_FACTOR_PRECISION = 1e18;

    uint256 public maxLtvBps = 5000;                // Max LTV: 50.00%
    uint256 public liquidationThresholdBps = 7000; // Liquidation Threshold: 70.00%
    uint256 public liquidationPenaltyBps = 1000;   // Liquidation Penalty: 10.00%
    uint256 public borrowRateBpsPerYear = 500;      // Borrow Rate: 5.00% APY

    event RiskParametersUpdated(
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 liquidationPenaltyBps,
        uint256 borrowRateBpsPerYear
    );
    event InterestAccrued(
        uint256 indexed vaultId,
        uint256 interestAccrued,
        uint256 totalAccumulatedInterest,
        uint256 timestamp
    );

    error InvalidRiskParameters();
    error UnauthorizedAdmin(address caller);

    function setRiskParameters(
        uint256 _maxLtvBps,
        uint256 _liquidationThresholdBps,
        uint256 _liquidationPenaltyBps,
        uint256 _borrowRateBpsPerYear
    ) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        if (_maxLtvBps > _liquidationThresholdBps || _liquidationThresholdBps > BPS_DENOMINATOR) {
            revert InvalidRiskParameters();
        }

        maxLtvBps = _maxLtvBps;
        liquidationThresholdBps = _liquidationThresholdBps;
        liquidationPenaltyBps = _liquidationPenaltyBps;
        borrowRateBpsPerYear = _borrowRateBpsPerYear;

        emit RiskParametersUpdated(_maxLtvBps, _liquidationThresholdBps, _liquidationPenaltyBps, _borrowRateBpsPerYear);
    }

    function accrueInterest(uint256 vaultId) public {
        CollateralVault storage vault = vaults[vaultId];
        uint256 dt = block.timestamp - vault.lastInterestUpdate;
        if (dt == 0) return;

        if (vault.principalDebt > 0) {
            uint256 interestNew = (vault.principalDebt * borrowRateBpsPerYear * dt) /
                (BPS_DENOMINATOR * SECONDS_PER_YEAR);
            vault.accumulatedInterest += interestNew;
            emit InterestAccrued(vaultId, interestNew, vault.accumulatedInterest, block.timestamp);
        }
        vault.lastInterestUpdate = block.timestamp;
    }

    function getPendingInterest(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        if (vault.principalDebt == 0 || vault.lastInterestUpdate == 0) return 0;
        uint256 dt = block.timestamp - vault.lastInterestUpdate;
        if (dt == 0) return 0;

        return (vault.principalDebt * borrowRateBpsPerYear * dt) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function getTotalDebt(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        return vault.principalDebt + vault.accumulatedInterest + getPendingInterest(vaultId);
    }

    function calculateHealthFactor(uint256 vaultFmv, uint256 totalDebt) public view returns (uint256) {
        if (totalDebt == 0) {
            return type(uint256).max;
        }
        return (vaultFmv * liquidationThresholdBps * HEALTH_FACTOR_PRECISION) / (totalDebt * BPS_DENOMINATOR);
    }

    function getHealthFactor(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
        return calculateHealthFactor(vaultFmv, getTotalDebt(vaultId));
    }

    function getMaxBorrowCapacity(uint256 vaultFmv) public view returns (uint256) {
        return (vaultFmv * maxLtvBps) / BPS_DENOMINATOR;
    }
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (62 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-21): implement risk parameters, interest accrual, and health factor engine (relates to HF-21)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)

**Files:**
- Modify: `test/HoloFiVaultLoanCore.ts`

**Interfaces:**
- Consumes: `setRiskParameters`, `calculateHealthFactor`, `getMaxBorrowCapacity`, `getPendingInterest`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)**

Add integration tests to `test/HoloFiVaultLoanCore.ts`:

```ts
  it("Should allow admin to update risk parameters and calculate max borrow capacity & health factor", async function () {
    const { loanCore, admin, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(loanCore.connect(admin).setRiskParameters(4000n, 6000n, 1200n, 600n))
      .to.emit(loanCore, "RiskParametersUpdated")
      .withArgs(4000n, 6000n, 1200n, 600n);

    expect(await loanCore.maxLtvBps()).to.equal(4000n);

    await expect(
      loanCore.connect(unauthorized).setRiskParameters(4000n, 6000n, 1200n, 600n)
    ).to.be.revertedWithCustomError(loanCore, "UnauthorizedAdmin");

    const fmv = ethers.parseUnits("10000", 6);
    expect(await loanCore.getMaxBorrowCapacity(fmv)).to.equal(ethers.parseUnits("4000", 6));

    const zeroDebtHf = await loanCore.calculateHealthFactor(fmv, 0n);
    expect(zeroDebtHf).to.equal(ethers.MaxUint256);

    const safeHf = await loanCore.calculateHealthFactor(fmv, ethers.parseUnits("5000", 6));
    expect(safeHf).to.equal(ethers.parseEther("1.2"));
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (81 total tests: 62 Solidity + 25 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiVaultLoanCore.ts
git commit -m "test(HF-21): add TypeScript integration tests for risk engine and interest accrual (Fixes HF-21)"
```
