import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiCardPriceFeed Integration Tests", function () {
  async function deployPriceFeedFixture() {
    const [owner, admin, oracle, user] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const priceFeed = await ethers.deployContract("HoloFiCardPriceFeed", [await acm.getAddress()]);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, oracle.address);

    const cardTypeId1 = ethers.keccak256(ethers.toUtf8Bytes("Charizard_1st_Edition"));
    const cardTypeId2 = ethers.keccak256(ethers.toUtf8Bytes("Pikachu_Illustrator"));

    return { acm, priceFeed, owner, admin, oracle, user, cardTypeId1, cardTypeId2 };
  }

  it("Should set single price and query correctly", async function () {
    const { priceFeed, oracle, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price = ethers.parseUnits("50000", 18);
    await expect(priceFeed.connect(oracle).setPrice(cardTypeId1, price))
      .to.emit(priceFeed, "PriceUpdated");

    const [fetchedPrice, lastUpdated] = await priceFeed.getPrice(cardTypeId1);
    expect(fetchedPrice).to.equal(price);
    expect(lastUpdated).to.be.greaterThan(0n);
  });

  it("Should revert when unauthorized user attempts to set price", async function () {
    const { priceFeed, user, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price = ethers.parseUnits("50000", 18);
    await expect(priceFeed.connect(user).setPrice(cardTypeId1, price))
      .to.be.revertedWithCustomError(priceFeed, "UnauthorizedOracle")
      .withArgs(user.address);
  });

  it("Should revert when setting price to zero", async function () {
    const { priceFeed, oracle, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    await expect(priceFeed.connect(oracle).setPrice(cardTypeId1, 0n))
      .to.be.revertedWithCustomError(priceFeed, "ZeroPrice");
  });

  it("Should set batch prices correctly", async function () {
    const { priceFeed, oracle, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price1 = ethers.parseUnits("50000", 18);
    const price2 = ethers.parseUnits("150000", 18);

    await priceFeed.connect(oracle).setBatchPrices([cardTypeId1, cardTypeId2], [price1, price2]);

    const [p1, lastUpdated1] = await priceFeed.getPrice(cardTypeId1);
    const [p2, lastUpdated2] = await priceFeed.getPrice(cardTypeId2);

    expect(p1).to.equal(price1);
    expect(p2).to.equal(price2);
    expect(lastUpdated1).to.be.greaterThan(0n);
    expect(lastUpdated2).to.be.greaterThan(0n);
  });

  it("Should revert constructor with zero address ACM", async function () {
    await expect(ethers.deployContract("HoloFiCardPriceFeed", [ethers.ZeroAddress]))
      .to.be.revertedWithCustomError(await ethers.getContractFactory("HoloFiCardPriceFeed"), "ZeroAddressACM");
  });

  it("Should track and enumerate card types after single price update and duplicate updates", async function () {
    const { priceFeed, oracle, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    expect(await priceFeed.getCardTypesCount()).to.equal(0n);
    expect(await priceFeed.isSupportedCardType(cardTypeId1)).to.be.false;
    expect(await priceFeed.getAllCardTypes()).to.deep.equal([]);

    const price1 = ethers.parseUnits("50000", 18);
    await priceFeed.connect(oracle).setPrice(cardTypeId1, price1);

    expect(await priceFeed.getCardTypesCount()).to.equal(1n);
    expect(await priceFeed.isSupportedCardType(cardTypeId1)).to.be.true;
    expect(await priceFeed.getCardTypeAt(0)).to.equal(cardTypeId1);
    expect(await priceFeed.getAllCardTypes()).to.deep.equal([cardTypeId1]);

    // Duplicate price update should not increase count or duplicate entry
    const priceUpdated = ethers.parseUnits("55000", 18);
    await priceFeed.connect(oracle).setPrice(cardTypeId1, priceUpdated);

    expect(await priceFeed.getCardTypesCount()).to.equal(1n);
    expect(await priceFeed.isSupportedCardType(cardTypeId1)).to.be.true;
    expect(await priceFeed.getCardTypeAt(0)).to.equal(cardTypeId1);
    expect(await priceFeed.getAllCardTypes()).to.deep.equal([cardTypeId1]);
  });

  it("Should track and enumerate card types after batch price updates", async function () {
    const { priceFeed, oracle, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price1 = ethers.parseUnits("50000", 18);
    const price2 = ethers.parseUnits("150000", 18);

    await priceFeed.connect(oracle).setBatchPrices([cardTypeId1, cardTypeId2], [price1, price2]);

    expect(await priceFeed.getCardTypesCount()).to.equal(2n);
    expect(await priceFeed.isSupportedCardType(cardTypeId1)).to.be.true;
    expect(await priceFeed.isSupportedCardType(cardTypeId2)).to.be.true;
    expect(await priceFeed.getCardTypeAt(0)).to.equal(cardTypeId1);
    expect(await priceFeed.getCardTypeAt(1)).to.equal(cardTypeId2);
    expect(await priceFeed.getAllCardTypes()).to.deep.equal([cardTypeId1, cardTypeId2]);
  });

  it("Should revert when getCardTypeAt is called with out-of-bounds index", async function () {
    const { priceFeed, oracle, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    await expect(priceFeed.getCardTypeAt(0)).to.be.revertedWithPanic(0x32);

    await priceFeed.connect(oracle).setPrice(cardTypeId1, ethers.parseUnits("50000", 18));
    expect(await priceFeed.getCardTypeAt(0)).to.equal(cardTypeId1);
    await expect(priceFeed.getCardTypeAt(1)).to.be.revertedWithPanic(0x32);
  });

  it("Should correctly report supported and unsupported card types", async function () {
    const { priceFeed, oracle, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    expect(await priceFeed.isSupportedCardType(cardTypeId1)).to.be.false;
    expect(await priceFeed.isSupportedCardType(cardTypeId2)).to.be.false;

    await priceFeed.connect(oracle).setPrice(cardTypeId1, ethers.parseUnits("50000", 18));

    expect(await priceFeed.isSupportedCardType(cardTypeId1)).to.be.true;
    expect(await priceFeed.isSupportedCardType(cardTypeId2)).to.be.false;
  });
});
