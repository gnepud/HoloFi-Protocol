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
    await asset.connect(liquidator).approve(auctionAddr, ethers.parseUnits("5200", 6));

    const initialStoreBalance = await asset.balanceOf(store.address);

    // StartPrice = $6,000 (120% of $5,000)
    // Debt = $4,000, Penalty (10%) = $400, ReservePrice = $4,400
    // Time warp 24h -> CurrentPrice = $6,000 - (($6,000 - $4,400) * 24 / 48) = $5,200
    // Surplus = $5,200 - $4,400 = $800
    await networkHelpers.time.setNextBlockTimestamp(auctionStartTime + 86400n);

    await expect(dutchAuction.connect(liquidator).settleAuction(1n, poolAddr))
      .to.emit(dutchAuction, "AuctionSettled")
      .withArgs(
        1n,
        liquidator.address,
        poolAddr,
        ethers.parseUnits("5200", 6),
        ethers.parseUnits("4000", 6),
        ethers.parseUnits("400", 6),
        ethers.parseUnits("800", 6)
      );

    // Verify store received $800 surplus refund
    const finalStoreBalance = await asset.balanceOf(store.address);
    expect(finalStoreBalance - initialStoreBalance).to.equal(ethers.parseUnits("800", 6));

    // Verify pool asset balance restored + penalty ($100,000 + $400 penalty = $100,400)
    expect(await asset.balanceOf(poolAddr)).to.equal(ethers.parseUnits("100400", 6));

    // Verify liquidator owns card NFTs
    expect(await cardCollection.ownerOf(1n)).to.equal(liquidator.address);
    expect(await cardCollection.ownerOf(2n)).to.equal(liquidator.address);

    const card1Info = await cardCollection.getCard(1n);
    const card2Info = await cardCollection.getCard(2n);
    expect(card1Info.isLocked).to.be.false;
    expect(card2Info.isLocked).to.be.false;

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.status).to.equal(2n); // VaultStatus.Closed
    expect(vaultInfo.principalDebt).to.equal(0n);
  });

  it("Should allow treasury to execute buyback for expired unsold auction, restoring pool principal and assigning card NFTs", async function () {
    const { loanCore, cardCollection, dutchAuction, poolFactory, acm, admin, store, minter, liquidator, unauthorized } = await networkHelpers.loadFixture(deployDutchAuctionFixture);

    const [,,,,,, treasury] = await ethers.getSigners();
    await dutchAuction.connect(admin).setTreasury(treasury.address);
    expect(await dutchAuction.treasury()).to.equal(treasury.address);

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
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    // Drop FMV so HF < 1.0
    await loanCore.connect(minter).setBatchCardFmv(
      [1n, 2n],
      [ethers.parseUnits("1000", 6), ethers.parseUnits("4000", 6)]
    );

    const auctionAddr = await dutchAuction.getAddress();
    await dutchAuction.connect(liquidator).startAuction(1n);

    // Attempt premature buyback before 48h expiration -> revert AuctionNotExpired
    await expect(dutchAuction.connect(treasury).treasuryBuyback(1n, poolAddr))
      .to.be.revertedWithCustomError(dutchAuction, "AuctionNotExpired");

    // Attempt buyback by unauthorized caller -> revert UnauthorizedTreasury
    await networkHelpers.time.increase(49 * 3600);
    await expect(dutchAuction.connect(unauthorized).treasuryBuyback(1n, poolAddr))
      .to.be.revertedWithCustomError(dutchAuction, "UnauthorizedTreasury");

    // Treasury executes buyback
    await asset.mint(treasury.address, ethers.parseUnits("4000", 6));
    await asset.connect(treasury).approve(auctionAddr, ethers.parseUnits("4000", 6));

    await expect(dutchAuction.connect(treasury).treasuryBuyback(1n, poolAddr))
      .to.emit(dutchAuction, "TreasuryBuybackExecuted")
      .withArgs(1n, treasury.address, poolAddr, ethers.parseUnits("4000", 6));

    // Verify lending pool balance is restored to 100,000 EURC (no penalty added)
    expect(await asset.balanceOf(poolAddr)).to.equal(ethers.parseUnits("100000", 6));

    // Verify treasury owns card NFTs
    expect(await cardCollection.ownerOf(1n)).to.equal(treasury.address);
    expect(await cardCollection.ownerOf(2n)).to.equal(treasury.address);

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.status).to.equal(2n); // VaultStatus.Closed
    expect(vaultInfo.principalDebt).to.equal(0n);
  });

});

