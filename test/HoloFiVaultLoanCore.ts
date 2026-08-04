import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiVaultLoanCore Integration Tests", function () {
  async function deployLoanCoreFixture() {
    const [owner, admin, minter, store, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const cardCollection = await ethers.deployContract("HoloFiVaultCard", [
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

    const minterRole = await acm.MINTER_ROLE();
    const adminRole = await acm.ADMIN_ROLE();
    await acm.connect(admin).grantRole(minterRole, minter.address);
    await acm.connect(admin).grantRole(adminRole, await loanCore.getAddress());
    await acm.connect(admin).setKybStatus(store.address, true);

    const attestationHash1 = ethers.keccak256(ethers.toUtf8Bytes("attestation1"));
    const attestationHash2 = ethers.keccak256(ethers.toUtf8Bytes("attestation2"));

    await cardCollection.connect(minter).mintCard(store.address, attestationHash1, "ipfs://card1");
    await cardCollection.connect(minter).mintCard(store.address, attestationHash2, "ipfs://card2");

    return { acm, cardCollection, poolFactory, loanCore, owner, admin, minter, store, unauthorized };
  }

  it("Should allow KYB approved store to create vault and escrow/withdraw cards", async function () {
    const { cardCollection, loanCore, store } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const loanCoreAddr = await loanCore.getAddress();

    await expect(loanCore.connect(store).createVault())
      .to.emit(loanCore, "VaultCreated")
      .withArgs(1n, store.address);

    await cardCollection.connect(store).setApprovalForAll(loanCoreAddr, true);

    await expect(loanCore.connect(store).depositCollateral(1n, [1n, 2n]))
      .to.emit(loanCore, "CollateralDeposited")
      .withArgs(1n, store.address, [1n, 2n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(loanCoreAddr);
    expect(await cardCollection.ownerOf(2n)).to.equal(loanCoreAddr);

    const card1Info = await cardCollection.getCard(1n);
    expect(card1Info.isLocked).to.be.true;

    await expect(loanCore.connect(store).withdrawCollateral(1n, [1n]))
      .to.emit(loanCore, "CollateralWithdrawn")
      .withArgs(1n, store.address, [1n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(store.address);

    const card1InfoUnlocked = await cardCollection.getCard(1n);
    expect(card1InfoUnlocked.isLocked).to.be.false;

    const remainingTokens = await loanCore.getVaultTokenIds(1n);
    expect(remainingTokens.length).to.equal(1);
    expect(remainingTokens[0]).to.equal(2n);
  });

  it("Should revert when non-KYB store attempts to create vault", async function () {
    const { loanCore, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(
      loanCore.connect(unauthorized).createVault()
    ).to.be.revertedWithCustomError(loanCore, "KybRequired")
     .withArgs(unauthorized.address);
  });

  it("Should allow admin to update risk parameters and revert for unauthorized user", async function () {
    const { loanCore, admin, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(loanCore.connect(admin).setRiskParameters(4000n, 6000n, 1200n, 600n))
      .to.emit(loanCore, "RiskParametersUpdated")
      .withArgs(4000n, 6000n, 1200n, 600n);

    expect(await loanCore.maxLtvBps()).to.equal(4000n);
    expect(await loanCore.liquidationThresholdBps()).to.equal(6000n);
    expect(await loanCore.liquidationPenaltyBps()).to.equal(1200n);
    expect(await loanCore.borrowRateBpsPerYear()).to.equal(600n);

    await expect(
      loanCore.connect(unauthorized).setRiskParameters(4000n, 6000n, 1200n, 600n)
    ).to.be.revertedWithCustomError(loanCore, "UnauthorizedAdmin")
     .withArgs(unauthorized.address);
  });

  it("Should calculate max borrow capacity correctly", async function () {
    const { loanCore } = await networkHelpers.loadFixture(deployLoanCoreFixture);
    const fmv = ethers.parseUnits("10000", 6);
    expect(await loanCore.getMaxBorrowCapacity(fmv)).to.equal(ethers.parseUnits("5000", 6));
  });

  it("Should calculate health factor correctly for zero debt and active debt", async function () {
    const { loanCore } = await networkHelpers.loadFixture(deployLoanCoreFixture);
    const fmv = ethers.parseUnits("10000", 6);

    const zeroDebtHf = await loanCore.calculateHealthFactor(fmv, 0n);
    expect(zeroDebtHf).to.equal(ethers.MaxUint256);

    const safeHf = await loanCore.calculateHealthFactor(fmv, ethers.parseUnits("5000", 6));
    expect(safeHf).to.equal(ethers.parseEther("1.4"));
  });

  it("Should allow oracle to set card FMVs, calculate vault FMV, and execute borrow from lending pool", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

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

    expect(await loanCore.getVaultFMV(1n)).to.equal(ethers.parseUnits("10000", 6));

    const borrowAmount = ethers.parseUnits("4000", 6);

    await expect(loanCore.connect(store).borrow(1n, borrowAmount, poolAddr))
      .to.emit(loanCore, "BorrowExecuted")
      .withArgs(1n, store.address, poolAddr, borrowAmount, borrowAmount);

    expect(await asset.balanceOf(store.address)).to.equal(borrowAmount);
    expect(await asset.balanceOf(poolAddr)).to.equal(ethers.parseUnits("96000", 6));

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.equal(borrowAmount);

    await expect(
      loanCore.connect(store).borrow(1n, ethers.parseUnits("2000", 6), poolAddr)
    ).to.be.revertedWithCustomError(loanCore, "ExceedsMaxBorrowCapacity");
  });

  it("Should allow store to execute full loan repayment and release collateral NFTs", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

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

    const borrowTx = await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);
    const borrowBlock = await ethers.provider.getBlock(borrowTx.blockNumber!);
    const borrowTimestamp = borrowBlock!.timestamp;

    await asset.mint(store.address, ethers.parseUnits("200", 6));
    await asset.connect(store).approve(poolAddr, ethers.MaxUint256);

    await networkHelpers.time.setNextBlockTimestamp(borrowTimestamp + 86400 * 365);

    const totalDebt = ethers.parseUnits("4200", 6);

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
    expect(await asset.balanceOf(poolAddr)).to.equal(ethers.parseUnits("100200", 6));

    await expect(loanCore.connect(store).withdrawCollateral(1n, [1n, 2n]))
      .to.emit(loanCore, "CollateralWithdrawn")
      .withArgs(1n, store.address, [1n, 2n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(store.address);
    expect(await cardCollection.ownerOf(2n)).to.equal(store.address);

    const card1Info = await cardCollection.getCard(1n);
    const card2Info = await cardCollection.getCard(2n);
    expect(card1Info.isLocked).to.be.false;
    expect(card2Info.isLocked).to.be.false;
  });

  it("Should revert borrow or repay with UnregisteredLendingPool for unapproved pool address", async function () {
    const { loanCore, store, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await loanCore.connect(store).createVault();

    await expect(
      loanCore.connect(store).borrow(1n, 1000n, unauthorized.address)
    ).to.be.revertedWithCustomError(loanCore, "UnregisteredLendingPool")
     .withArgs(unauthorized.address);

    await expect(
      loanCore.connect(store).repay(1n, 1000n, unauthorized.address)
    ).to.be.revertedWithCustomError(loanCore, "UnregisteredLendingPool")
     .withArgs(unauthorized.address);
  });

  it("Should allow store to withdraw excess collateral when remaining FMV satisfies LTV ratio", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

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

    // Borrow $2,500 (total FMV = $10,000, max borrow = $5,000)
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("2500", 6), poolAddr);

    // Attempt to withdraw card 1 ($6,000 FMV). Remaining FMV = $4,000 (max borrow = $2,000). Debt = $2,500 -> reverts
    await expect(
      loanCore.connect(store).withdrawCollateral(1n, [1n])
    ).to.be.revertedWithCustomError(loanCore, "InsufficientCollateralRatio");

    // Withdraw card 2 ($4,000 FMV). Remaining FMV = $6,000 (max borrow = $3,000). Debt = $2,500 -> succeeds
    await loanCore.connect(store).withdrawCollateral(1n, [2n]);

    expect(await cardCollection.ownerOf(2n)).to.equal(store.address);
  });

  it("Should allow store to execute atomic repayAndWithdraw to reduce debt and free collateral", async function () {
    const { loanCore, cardCollection, acm, admin, store, minter, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, minter.address);

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

    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6), poolAddr);

    await asset.mint(store.address, ethers.parseUnits("2001", 6));
    await asset.connect(store).approve(poolAddr, ethers.parseUnits("2001", 6));

    // Repay $2,000 + accrued interest and withdraw card 1 ($6,000 FMV). Remaining debt <= $2,000, remaining FMV = $4,000 (max borrow = $2,000) -> succeeds
    const repayAmount = ethers.parseUnits("2000", 6) + 100n;
    await loanCore.connect(store).repayAndWithdraw(1n, repayAmount, poolAddr, [1n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(store.address);

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.be.lte(ethers.parseUnits("2000", 6));
  });
});


