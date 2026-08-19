import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiLendingPoolFactory Integration Tests", function () {
  async function deployFactoryFixture() {
    const [owner, admin, user, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const factory = await ethers.deployContract("HoloFiLendingPoolFactory", [await acm.getAddress()]);
    const eurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const weth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);

    return { acm, factory, eurc, weth, owner, admin, user, unauthorized };
  }

  it("Should allow admin to deploy pool and register in lookup mapping with risk parameters", async function () {
    const { factory, eurc, weth, admin } = await networkHelpers.loadFixture(deployFactoryFixture);

    const eurcAddr = await eurc.getAddress();
    const wethAddr = await weth.getAddress();

    await expect(
      factory.connect(admin).createPool(
        eurcAddr,
        "Premium Pool EURC",
        "pEURC",
        5000n,
        7000n,
        1000n,
        500n
      )
    ).to.emit(factory, "PoolCreated");

    const eurcPoolAddr = await factory.getPool(eurcAddr);
    expect(eurcPoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(await factory.allPools(0n)).to.equal(eurcPoolAddr);
    expect(await factory.getPoolsByAssetLength(eurcAddr)).to.equal(1n);

    const eurcPool = await ethers.getContractAt("HoloFiLendingPool", eurcPoolAddr);
    expect(await eurcPool.maxLtvBps()).to.equal(5000n);
    expect(await eurcPool.liquidationThresholdBps()).to.equal(7000n);
    expect(await eurcPool.liquidationPenaltyBps()).to.equal(1000n);
    expect(await eurcPool.borrowRateBpsPerYear()).to.equal(500n);

    await expect(
      factory.connect(admin).createPool(
        wethAddr,
        "HoloFi Pool WETH",
        "pWETH",
        4000n,
        6000n,
        1200n,
        600n
      )
    ).to.emit(factory, "PoolCreated");

    const wethPoolAddr = await factory.getPool(wethAddr);
    expect(wethPoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(await factory.allPoolsLength()).to.equal(2n);

    const wethPool = await ethers.getContractAt("HoloFiLendingPool", wethPoolAddr);
    expect(await wethPool.maxLtvBps()).to.equal(4000n);
    expect(await wethPool.liquidationThresholdBps()).to.equal(6000n);
    expect(await wethPool.liquidationPenaltyBps()).to.equal(1200n);
    expect(await wethPool.borrowRateBpsPerYear()).to.equal(600n);
  });

  it("Should allow creating multiple pools for the same underlying asset with distinct risk parameters", async function () {
    const { factory, eurc, admin } = await networkHelpers.loadFixture(deployFactoryFixture);
    const eurcAddr = await eurc.getAddress();

    await factory.connect(admin).createPool(
      eurcAddr,
      "Premium Pool EURC",
      "pEURC",
      5000n,
      7000n,
      1000n,
      500n
    );
    const premiumPoolAddr = await factory.getPool(eurcAddr);

    await factory.connect(admin).createPool(
      eurcAddr,
      "Deluxe Pool EURC",
      "dEURC",
      4000n,
      7000n,
      1000n,
      800n
    );

    const eurcPools = await factory.getPoolsByAsset(eurcAddr);
    expect(eurcPools.length).to.equal(2);
    expect(eurcPools[0]).to.equal(premiumPoolAddr);
    const deluxePoolAddr = eurcPools[1];
    expect(deluxePoolAddr).to.not.equal(premiumPoolAddr);

    expect(await factory.isValidPool(premiumPoolAddr)).to.be.true;
    expect(await factory.isValidPool(deluxePoolAddr)).to.be.true;
    expect(await factory.allPoolsLength()).to.equal(2n);

    const deluxePool = await ethers.getContractAt("HoloFiLendingPool", deluxePoolAddr);
    expect(await deluxePool.name()).to.equal("Deluxe Pool EURC");
    expect(await deluxePool.symbol()).to.equal("dEURC");
    expect(await deluxePool.maxLtvBps()).to.equal(4000n);
    expect(await deluxePool.borrowRateBpsPerYear()).to.equal(800n);
  });

  it("Should revert when unauthorized user attempts to create pool", async function () {
    const { factory, eurc, unauthorized } = await networkHelpers.loadFixture(deployFactoryFixture);
    const eurcAddr = await eurc.getAddress();

    await expect(
      factory.connect(unauthorized).createPool(eurcAddr, "HoloFi Pool EURC", "pEURC", 5000n, 7000n, 1000n, 500n)
    ).to.be.revertedWithCustomError(factory, "UnauthorizedOperator")
     .withArgs(unauthorized.address);
  });

  it("Should set isValidPool to true when pool is created", async function () {
    const { factory, eurc, admin } = await networkHelpers.loadFixture(deployFactoryFixture);
    await factory.connect(admin).createPool(await eurc.getAddress(), "Pool EURC", "pEURC", 5000n, 7000n, 1000n, 500n);
    const poolAddr = await factory.getPool(await eurc.getAddress());
    expect(await factory.isValidPool(poolAddr)).to.be.true;
  });
});
