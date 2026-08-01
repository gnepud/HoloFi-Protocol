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
    ]);

    const poolWeth = await ethers.deployContract("HoloFiLendingPool", [
      await mockWeth.getAddress(),
      "HoloFi Pool WETH",
      "pWETH",
      await acm.getAddress(),
    ]);

    await mockEurc.mint(lp.address, ethers.parseUnits("10000", 6));
    await mockEurc.connect(lp).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    await mockWeth.mint(lp.address, ethers.parseUnits("10", 18));
    await mockWeth.connect(lp).approve(await poolWeth.getAddress(), ethers.MaxUint256);

    return { acm, mockEurc, mockWeth, poolEurc, poolWeth, owner, admin, lp, borrower, fakeLoanCore, unauthorized };
  }

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
});
