import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiLendingPool Integration Tests", function () {
  async function deployLendingPoolFixture() {
    const [owner, admin, lp, borrower, fakeLoanCore, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const mockEurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const mockWeth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);

    const poolEurc = await ethers.deployContract("HoloFiLendingPool", [
      await mockEurc.getAddress(),
      "HoloFi Pool EURC",
      "pEURC",
      await acm.getAddress(),
      5000n,
      7000n,
      1000n,
      500n,
    ]);

    const poolWeth = await ethers.deployContract("HoloFiLendingPool", [
      await mockWeth.getAddress(),
      "HoloFi Pool WETH",
      "pWETH",
      await acm.getAddress(),
      5000n,
      7000n,
      1000n,
      500n,
    ]);

    await mockEurc.mint(lp.address, ethers.parseUnits("10000", 6));
    await mockEurc.connect(lp).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    await mockWeth.mint(lp.address, ethers.parseUnits("10", 18));
    await mockWeth.connect(lp).approve(await poolWeth.getAddress(), ethers.MaxUint256);

    return { acm, mockEurc, mockWeth, poolEurc, poolWeth, owner, admin, lp, borrower, fakeLoanCore, unauthorized };
  }

  it("Should initialize risk parameters and allow admin to update them with RiskParametersUpdated event", async function () {
    const { poolEurc, admin } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    expect(await poolEurc.maxLtvBps()).to.equal(5000n);
    expect(await poolEurc.liquidationThresholdBps()).to.equal(7000n);
    expect(await poolEurc.liquidationPenaltyBps()).to.equal(1000n);
    expect(await poolEurc.borrowRateBpsPerYear()).to.equal(500n);

    await expect(poolEurc.connect(admin).setRiskParameters(4000n, 6000n, 1200n, 600n))
      .to.emit(poolEurc, "RiskParametersUpdated")
      .withArgs(4000n, 6000n, 1200n, 600n);

    expect(await poolEurc.maxLtvBps()).to.equal(4000n);
    expect(await poolEurc.liquidationThresholdBps()).to.equal(6000n);
    expect(await poolEurc.liquidationPenaltyBps()).to.equal(1200n);
    expect(await poolEurc.borrowRateBpsPerYear()).to.equal(600n);
  });

  it("Should revert setRiskParameters for unauthorized caller with UnauthorizedAdmin", async function () {
    const { poolEurc, unauthorized } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    await expect(
      poolEurc.connect(unauthorized).setRiskParameters(4000n, 6000n, 1200n, 600n)
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedAdmin")
     .withArgs(unauthorized.address);
  });

  it("Should revert setRiskParameters and constructor when risk parameters are invalid", async function () {
    const { poolEurc, admin, mockEurc, acm } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    // maxLtvBps > liquidationThresholdBps
    await expect(
      poolEurc.connect(admin).setRiskParameters(7001n, 7000n, 1000n, 500n)
    ).to.be.revertedWithCustomError(poolEurc, "InvalidRiskParameters");

    // liquidationThresholdBps > 10000
    await expect(
      poolEurc.connect(admin).setRiskParameters(5000n, 10001n, 1000n, 500n)
    ).to.be.revertedWithCustomError(poolEurc, "InvalidRiskParameters");

    // Constructor validation: maxLtv > lt
    const HoloFiLendingPool = await ethers.getContractFactory("HoloFiLendingPool");
    await expect(
      ethers.deployContract("HoloFiLendingPool", [
        await mockEurc.getAddress(),
        "Invalid Pool",
        "pINV",
        await acm.getAddress(),
        7500n,
        7000n,
        1000n,
        500n,
      ])
    ).to.be.revertedWithCustomError(HoloFiLendingPool, "InvalidRiskParameters");

    // Constructor validation: lt > 10000
    await expect(
      ethers.deployContract("HoloFiLendingPool", [
        await mockEurc.getAddress(),
        "Invalid Pool",
        "pINV",
        await acm.getAddress(),
        5000n,
        10001n,
        1000n,
        500n,
      ])
    ).to.be.revertedWithCustomError(HoloFiLendingPool, "InvalidRiskParameters");
  });

  it("Should allow LPs to deposit EURC/WETH and receive corresponding pToken shares", async function () {
    const { mockEurc, mockWeth, poolEurc, poolWeth, lp } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    const eurcAmount = ethers.parseUnits("1000", 6);
    const expectedEurcShares = ethers.parseUnits("1000", 9); // 6 + 3 = 9 decimals
    await poolEurc.connect(lp).deposit(eurcAmount, lp.address);
    expect(await poolEurc.balanceOf(lp.address)).to.equal(expectedEurcShares);
    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(eurcAmount);

    const wethAmount = ethers.parseUnits("2", 18);
    const expectedWethShares = ethers.parseUnits("2", 21); // 18 + 3 = 21 decimals
    await poolWeth.connect(lp).deposit(wethAmount, lp.address);
    expect(await poolWeth.balanceOf(lp.address)).to.equal(expectedWethShares);
    expect(await mockWeth.balanceOf(await poolWeth.getAddress())).to.equal(wethAmount);
  });

  it("Should allow admin to register loan core and execute liquidity draw/return", async function () {
    const { mockEurc, poolEurc, admin, lp, borrower, fakeLoanCore } = await networkHelpers.loadFixture(deployLendingPoolFixture);
    const depositAmount = ethers.parseUnits("1000", 6);
    const drawAmount = ethers.parseUnits("400", 6);

    await poolEurc.connect(lp).deposit(depositAmount, lp.address);

    await expect(poolEurc.connect(admin).setLoanCore(fakeLoanCore.address))
      .to.emit(poolEurc, "LoanCoreUpdated")
      .withArgs(fakeLoanCore.address);

    await expect(poolEurc.connect(fakeLoanCore).drawLiquidity(borrower.address, drawAmount))
      .to.emit(poolEurc, "LiquidityDrawn")
      .withArgs(borrower.address, drawAmount);

    expect(await mockEurc.balanceOf(borrower.address)).to.equal(drawAmount);

    await mockEurc.mint(borrower.address, ethers.parseUnits("50", 6));
    await mockEurc.connect(borrower).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    const returnAmount = ethers.parseUnits("450", 6);
    await expect(poolEurc.connect(fakeLoanCore).returnLiquidity(borrower.address, drawAmount, returnAmount))
      .to.emit(poolEurc, "LiquidityReturned")
      .withArgs(borrower.address, drawAmount, returnAmount);

    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(ethers.parseUnits("1050", 6));
  });

  it("Should revert when unauthorized caller attempts draw or setLoanCore", async function () {
    const { poolEurc, unauthorized, borrower, fakeLoanCore } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    await expect(
      poolEurc.connect(unauthorized).setLoanCore(fakeLoanCore.address)
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedAdmin")
     .withArgs(unauthorized.address);

    await expect(
      poolEurc.connect(unauthorized).drawLiquidity(borrower.address, 100n)
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedLoanCore")
     .withArgs(unauthorized.address);
  });

  it("Should revert transfer or transferFrom of share tokens with custom error ShareTokenNonTransferable", async function () {
    const { poolEurc, lp, unauthorized } = await networkHelpers.loadFixture(deployLendingPoolFixture);
    const depositAmount = ethers.parseUnits("1000", 6);

    await poolEurc.connect(lp).deposit(depositAmount, lp.address);
    const shares = await poolEurc.balanceOf(lp.address);

    await expect(
      poolEurc.connect(lp).transfer(unauthorized.address, shares)
    ).to.be.revertedWithCustomError(poolEurc, "ShareTokenNonTransferable");

    await poolEurc.connect(lp).approve(unauthorized.address, shares);

    await expect(
      poolEurc.connect(unauthorized).transferFrom(lp.address, unauthorized.address, shares)
    ).to.be.revertedWithCustomError(poolEurc, "ShareTokenNonTransferable");
  });

  it("Should allow admin to set eligibility policy and check collateral allowance", async function () {
    const { poolEurc, admin, acm, unauthorized } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    // Initial policy is address(0), so isCollateralAllowed returns true
    const cardTypeId = ethers.keccak256(ethers.toUtf8Bytes("TestCard"));
    expect(await poolEurc.eligibilityPolicy()).to.equal(ethers.ZeroAddress);
    expect(await poolEurc.isCollateralAllowed(cardTypeId)).to.be.true;

    // Deploy GradeEligibilityPolicy for PSA 10+
    const policy = await ethers.deployContract("GradeEligibilityPolicy", [
      await acm.getAddress(),
      "PSA",
      10n,
      0n,
    ]);
    const policyAddr = await policy.getAddress();

    // Unauthorized caller reverts
    await expect(
      poolEurc.connect(unauthorized).setEligibilityPolicy(policyAddr)
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedAdmin")
     .withArgs(unauthorized.address);

    // Admin sets policy
    await expect(poolEurc.connect(admin).setEligibilityPolicy(policyAddr))
      .to.emit(poolEurc, "EligibilityPolicyUpdated")
      .withArgs(policyAddr);

    expect(await poolEurc.eligibilityPolicy()).to.equal(policyAddr);
    // Unregistered card is not eligible
    expect(await poolEurc.isCollateralAllowed(cardTypeId)).to.be.false;
  });

  it("Should maintain stable totalAssets and share price when liquidity is drawn and returned (C-01 fix)", async function () {
    const { mockEurc, poolEurc, admin, lp, borrower, fakeLoanCore, unauthorized } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    await poolEurc.connect(admin).setLoanCore(fakeLoanCore.address);

    // 1. LP deposits 100,000 EURC
    const initialDeposit = ethers.parseUnits("100000", 6);
    await mockEurc.mint(lp.address, initialDeposit);
    await mockEurc.connect(lp).approve(await poolEurc.getAddress(), ethers.MaxUint256);
    await poolEurc.connect(lp).deposit(initialDeposit, lp.address);

    expect(await poolEurc.totalAssets()).to.equal(initialDeposit);
    expect(await poolEurc.totalSupply()).to.equal(ethers.parseUnits("100000", 9));
    expect(await poolEurc.totalBorrows()).to.equal(0n);

    // 2. Borrower borrows 90,000 EURC through loanCore
    const borrowAmount = ethers.parseUnits("90000", 6);
    await poolEurc.connect(fakeLoanCore).drawLiquidity(borrower.address, borrowAmount);

    expect(await poolEurc.totalBorrows()).to.equal(borrowAmount);
    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(ethers.parseUnits("10000", 6));
    // totalAssets MUST remain 100,000 EURC (10,000 cash + 90,000 totalBorrows)
    expect(await poolEurc.totalAssets()).to.equal(initialDeposit);

    // 3. A second user deposits 10,000 EURC while loan is active
    const secondUserDeposit = ethers.parseUnits("10000", 6);
    const expectedSecondUserShares = ethers.parseUnits("10000", 9);
    await mockEurc.mint(unauthorized.address, secondUserDeposit);
    await mockEurc.connect(unauthorized).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    // convertToShares must evaluate to 10,000 shares in 9 decimals (1:1 with offset 3), NOT 100,000 shares
    expect(await poolEurc.convertToShares(secondUserDeposit)).to.equal(expectedSecondUserShares);
    await poolEurc.connect(unauthorized).deposit(secondUserDeposit, unauthorized.address);

    expect(await poolEurc.balanceOf(unauthorized.address)).to.equal(expectedSecondUserShares);
    expect(await poolEurc.totalAssets()).to.equal(ethers.parseUnits("110000", 6));
    expect(await poolEurc.totalSupply()).to.equal(ethers.parseUnits("110000", 9));

    // 4. Borrower repays 90,000 principal + 4,500 interest = 94,500 EURC
    const repaymentAmount = ethers.parseUnits("94500", 6);
    await mockEurc.mint(borrower.address, repaymentAmount);
    await mockEurc.connect(borrower).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    await poolEurc.connect(fakeLoanCore).returnLiquidity(borrower.address, borrowAmount, repaymentAmount);

    expect(await poolEurc.totalBorrows()).to.equal(0n);
    expect(await poolEurc.totalAssets()).to.equal(ethers.parseUnits("114500", 6));

    // 5. LP and second user can redeem fair proportional share of capital and yield
    const lpShares = await poolEurc.balanceOf(lp.address);
    const lpAssets = await poolEurc.previewRedeem(lpShares);
    // LP gets ~104,090.9 EURC (retains 100k principal + earns proportional yield)
    expect(lpAssets).to.be.gt(initialDeposit);

    const secondUserShares = await poolEurc.balanceOf(unauthorized.address);
    const secondUserAssets = await poolEurc.previewRedeem(secondUserShares);
    // Second user gets ~10,409.09 EURC (retains 10k principal + earns proportional yield, no abnormal profit)
    expect(secondUserAssets).to.be.gt(secondUserDeposit);
    expect(secondUserAssets).to.be.lt(ethers.parseUnits("11000", 6));
  });

  it("H-04: Should enforce Pausable access control and pause ERC-4626 operations in LendingPool", async function () {
    const { mockEurc, poolEurc, admin, lp, unauthorized, acm } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    const pauserRole = await acm.PAUSER_ROLE();
    const pauser = unauthorized;

    // Unauthorized cannot pause
    await expect(
      poolEurc.connect(pauser).pause()
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedPauser").withArgs(pauser.address);

    // Grant PAUSER_ROLE
    await acm.connect(admin).grantRole(pauserRole, pauser.address);

    // Pauser can pause
    await poolEurc.connect(pauser).pause();
    expect(await poolEurc.paused()).to.be.true;

    // Pauser cannot unpause (only admin)
    await expect(
      poolEurc.connect(pauser).unpause()
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedAdmin").withArgs(pauser.address);

    // Deposit reverts when paused
    const amount = ethers.parseUnits("1000", 6);
    await mockEurc.mint(lp.address, amount);
    await mockEurc.connect(lp).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    await expect(
      poolEurc.connect(lp).deposit(amount, lp.address)
    ).to.be.revertedWithCustomError(poolEurc, "EnforcedPause");

    // Admin unpauses
    await poolEurc.connect(admin).unpause();
    expect(await poolEurc.paused()).to.be.false;

    // Deposit succeeds after unpause
    await poolEurc.connect(lp).deposit(amount, lp.address);
    expect(await poolEurc.totalAssets()).to.equal(amount);
  });

  it("M-04: Should safely transfer assets via SafeERC20 during drawLiquidity and returnLiquidity", async function () {
    const { mockEurc, poolEurc, admin, lp, borrower, fakeLoanCore } =
      await networkHelpers.loadFixture(deployLendingPoolFixture);

    await poolEurc.connect(admin).setLoanCore(fakeLoanCore.address);

    const depositAmount = ethers.parseUnits("5000", 6);
    await mockEurc.mint(lp.address, depositAmount);
    await mockEurc.connect(lp).approve(await poolEurc.getAddress(), ethers.MaxUint256);
    await poolEurc.connect(lp).deposit(depositAmount, lp.address);

    // drawLiquidity uses safeTransfer
    const drawAmount = ethers.parseUnits("2000", 6);
    await poolEurc.connect(fakeLoanCore).drawLiquidity(borrower.address, drawAmount);
    expect(await mockEurc.balanceOf(borrower.address)).to.equal(drawAmount);

    // returnLiquidity fails if borrower hasn't approved
    await expect(
      poolEurc.connect(fakeLoanCore).returnLiquidity(borrower.address, drawAmount, drawAmount)
    ).to.be.revertedWithCustomError(mockEurc, "ERC20InsufficientAllowance");

    // returnLiquidity succeeds after approval
    await mockEurc.connect(borrower).approve(await poolEurc.getAddress(), ethers.MaxUint256);
    await poolEurc.connect(fakeLoanCore).returnLiquidity(borrower.address, drawAmount, drawAmount);
    expect(await poolEurc.totalBorrows()).to.equal(0n);
    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(depositAmount);
  });

  it("Should revert on zero assets or zero shares deposit/mint/withdraw/redeem", async function () {
    const { poolEurc, lp } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    await expect(poolEurc.connect(lp).deposit(0n, lp.address)).to.be.revertedWithCustomError(
      poolEurc,
      "ZeroAssets"
    );

    await expect(poolEurc.connect(lp).mint(0n, lp.address)).to.be.revertedWithCustomError(
      poolEurc,
      "ZeroShares"
    );

    const depositAmount = ethers.parseUnits("100", 6);
    await poolEurc.connect(lp).deposit(depositAmount, lp.address);

    await expect(poolEurc.connect(lp).withdraw(0n, lp.address, lp.address)).to.be.revertedWithCustomError(
      poolEurc,
      "ZeroAssets"
    );

    await expect(poolEurc.connect(lp).redeem(0n, lp.address, lp.address)).to.be.revertedWithCustomError(
      poolEurc,
      "ZeroShares"
    );
  });

  it("Should strictly revert with ZeroShares when deposit amount rounds down to zero shares in inflated vault", async function () {
    const { mockEurc, poolEurc, unauthorized, borrower } =
      await networkHelpers.loadFixture(deployLendingPoolFixture);

    const attacker = unauthorized;
    const victim = borrower;

    await mockEurc.mint(attacker.address, ethers.parseUnits("20000", 6));
    await mockEurc.connect(attacker).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    await mockEurc.mint(victim.address, ethers.parseUnits("100", 6));
    await mockEurc.connect(victim).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    // 1. Attacker deposits 1 wei
    await poolEurc.connect(attacker).deposit(1n, attacker.address);

    // 2. Attacker donates 10,000 EURC
    await mockEurc.connect(attacker).transfer(await poolEurc.getAddress(), ethers.parseUnits("10000", 6));

    // 3. Victim deposits small non-zero amount (1000 wei = 0.001 EURC) that computes to 0 shares
    expect(await poolEurc.previewDeposit(1000n)).to.equal(0n);

    // 4. Must strictly revert with ZeroShares (assets > 0, shares == 0)
    await expect(
      poolEurc.connect(victim).deposit(1000n, victim.address)
    ).to.be.revertedWithCustomError(poolEurc, "ZeroShares");
  });

  it("Should mitigate ERC-4626 donation / inflation attack via decimalsOffset virtual shares", async function () {
    const { mockEurc, poolEurc, unauthorized, borrower } =
      await networkHelpers.loadFixture(deployLendingPoolFixture);

    const attacker = unauthorized;
    const victim = borrower;

    // Attacker has funds
    await mockEurc.mint(attacker.address, ethers.parseUnits("10000", 6));
    await mockEurc.connect(attacker).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    // Victim has funds
    await mockEurc.mint(victim.address, ethers.parseUnits("1000", 6));
    await mockEurc.connect(victim).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    // 1. Attacker makes minimal 1 wei initial deposit
    await poolEurc.connect(attacker).deposit(1n, attacker.address);
    const attackerShares = await poolEurc.balanceOf(attacker.address);
    // With decimalsOffset 3, attacker receives 1000 shares
    expect(attackerShares).to.equal(1000n);

    // 2. Attacker attempts donation attack: transfers 1,000 EURC directly to pool
    await mockEurc.connect(attacker).transfer(await poolEurc.getAddress(), ethers.parseUnits("1000", 6));

    // 3. Victim deposits 100 EURC
    const victimDeposit = ethers.parseUnits("100", 6);
    await poolEurc.connect(victim).deposit(victimDeposit, victim.address);
    const victimShares = await poolEurc.balanceOf(victim.address);

    // Victim MUST receive non-zero shares (not rounded down to 0)
    expect(victimShares).to.be.gt(0n);

    // 4. Attacker attempts to redeem all initial shares
    const attackerRedeemed = await poolEurc.connect(attacker).redeem.staticCall(attackerShares, attacker.address, attacker.address);

    // Attacker invested 1 wei + 1,000 EURC = 1,000.000001 EURC.
    // Attacker gets back only ~500 EURC due to virtual shares absorbing half the donation!
    expect(attackerRedeemed).to.be.lt(ethers.parseUnits("501", 6));
    expect(attackerRedeemed).to.be.gt(ethers.parseUnits("499", 6));
  });
});
