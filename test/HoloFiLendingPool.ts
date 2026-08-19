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
    await poolEurc.connect(lp).deposit(eurcAmount, lp.address);
    expect(await poolEurc.balanceOf(lp.address)).to.equal(eurcAmount);
    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(eurcAmount);

    const wethAmount = ethers.parseUnits("2", 18);
    await poolWeth.connect(lp).deposit(wethAmount, lp.address);
    expect(await poolWeth.balanceOf(lp.address)).to.equal(wethAmount);
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
    await expect(poolEurc.connect(fakeLoanCore).returnLiquidity(borrower.address, returnAmount))
      .to.emit(poolEurc, "LiquidityReturned")
      .withArgs(borrower.address, returnAmount);

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
});
