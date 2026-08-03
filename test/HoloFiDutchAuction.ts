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

    await loanCore.connect(admin).setRiskParameters(5000n, 7000n, 1000n, 0n);

    // Borrow $4,000 (total FMV = $10,000, max borrow = $5,000)
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    // Oracle drops card FMV so HF < 1.0 (card 1 dropped to $1,000, total FMV = $5,000)
    await loanCore.connect(minter).setBatchCardFmv(
      [1n, 2n],
      [ethers.parseUnits("1000", 6), ethers.parseUnits("4000", 6)]
    );

    const auctionAddr = await dutchAuction.getAddress();
    await expect(dutchAuction.connect(liquidator).startAuction(1n))
      .to.emit(dutchAuction, "AuctionStarted");

    const auction = await dutchAuction.getAuction(1n);
    const auctionStartTime = auction.startTime;

    await asset.mint(liquidator.address, ethers.parseUnits("6000", 6));
    await asset.connect(liquidator).approve(poolAddr, ethers.parseUnits("4000", 6));
    await asset.connect(liquidator).approve(auctionAddr, ethers.parseUnits("1000", 6));

    const initialStoreBalance = await asset.balanceOf(store.address);

    // Time warp 24h -> CurrentPrice = $5,000 (debt = $4,000, surplus = $1,000)
    await networkHelpers.time.setNextBlockTimestamp(auctionStartTime + 86400n);

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
