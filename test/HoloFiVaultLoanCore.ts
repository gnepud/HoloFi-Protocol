import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiVaultLoanCore Integration Tests", function () {
  async function deployLoanCoreFixture() {
    const [owner, admin, minter, store, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const vaultCard = await ethers.deployContract("HoloFiVaultCard", [
      "HoloFi TCG Cards",
      "HFC",
      await acm.getAddress(),
    ]);
    const poolFactory = await ethers.deployContract("HoloFiLendingPoolFactory", [await acm.getAddress()]);
    const priceFeed = await ethers.deployContract("HoloFiCardPriceFeed", [await acm.getAddress()]);
    const loanCore = await ethers.deployContract("HoloFiVaultLoanCore", [
      await acm.getAddress(),
      await vaultCard.getAddress(),
      await poolFactory.getAddress(),
      await priceFeed.getAddress(),
    ]);

    const minterRole = await acm.MINTER_ROLE();
    const adminRole = await acm.ADMIN_ROLE();
    const oracleRole = await acm.ORACLE_ROLE();

    await acm.connect(admin).grantRole(minterRole, minter.address);
    await acm.connect(admin).grantRole(oracleRole, minter.address);
    await acm.connect(admin).grantRole(adminRole, await loanCore.getAddress());
    await acm.connect(admin).setKybStatus(store.address, true);

    const cardTypeId1 = ethers.keccak256(ethers.toUtf8Bytes("CardType1"));
    const cardTypeId2 = ethers.keccak256(ethers.toUtf8Bytes("CardType2"));
    const attestationHash1 = ethers.keccak256(ethers.toUtf8Bytes("attestation1"));
    const attestationHash2 = ethers.keccak256(ethers.toUtf8Bytes("attestation2"));

    await vaultCard.connect(minter).mintCard(store.address, cardTypeId1, attestationHash1, "ipfs://card1");
    await vaultCard.connect(minter).mintCard(store.address, cardTypeId2, attestationHash2, "ipfs://card2");

    const eurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    await poolFactory.connect(admin).createPool(
      await eurc.getAddress(),
      "Pool EURC",
      "pEURC",
      5000n,
      7000n,
      1000n,
      500n
    );
    const poolEurcAddr = await poolFactory.getPool(await eurc.getAddress());
    const poolEurc = await ethers.getContractAt("HoloFiLendingPool", poolEurcAddr);
    await poolEurc.connect(admin).setLoanCore(await loanCore.getAddress());
    await eurc.mint(poolEurcAddr, ethers.parseUnits("100000", 6));

    return {
      acm,
      vaultCard,
      poolFactory,
      priceFeed,
      loanCore,
      eurc,
      poolEurc,
      poolEurcAddr,
      owner,
      admin,
      minter,
      store,
      unauthorized,
      cardTypeId1,
      cardTypeId2,
    };
  }

  it("Should revert constructor with zero address priceFeed", async function () {
    const { acm, vaultCard, poolFactory } = await networkHelpers.loadFixture(deployLoanCoreFixture);
    await expect(
      ethers.deployContract("HoloFiVaultLoanCore", [
        await acm.getAddress(),
        await vaultCard.getAddress(),
        await poolFactory.getAddress(),
        ethers.ZeroAddress,
      ])
    ).to.be.revertedWithCustomError(
      await ethers.getContractFactory("HoloFiVaultLoanCore"),
      "ZeroAddressPriceFeed"
    );
  });

  it("Should allow KYB approved store to create vault and escrow/withdraw cards", async function () {
    const { vaultCard, loanCore, store, poolEurcAddr } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const loanCoreAddr = await loanCore.getAddress();

    await expect(loanCore.connect(store).createVault(poolEurcAddr))
      .to.emit(loanCore, "VaultCreated")
      .withArgs(1n, store.address, poolEurcAddr);

    await vaultCard.connect(store).setApprovalForAll(loanCoreAddr, true);

    await expect(loanCore.connect(store).depositCollateral(1n, [1n, 2n]))
      .to.emit(loanCore, "CollateralDeposited")
      .withArgs(1n, store.address, [1n, 2n]);

    expect(await vaultCard.ownerOf(1n)).to.equal(loanCoreAddr);
    expect(await vaultCard.ownerOf(2n)).to.equal(loanCoreAddr);

    const card1Info = await vaultCard.getCard(1n);
    expect(card1Info.isLocked).to.be.true;

    await expect(loanCore.connect(store).withdrawCollateral(1n, [1n]))
      .to.emit(loanCore, "CollateralWithdrawn")
      .withArgs(1n, store.address, [1n]);

    expect(await vaultCard.ownerOf(1n)).to.equal(store.address);

    const card1InfoUnlocked = await vaultCard.getCard(1n);
    expect(card1InfoUnlocked.isLocked).to.be.false;

    const remainingTokens = await loanCore.getVaultTokenIds(1n);
    expect(remainingTokens.length).to.equal(1);
    expect(remainingTokens[0]).to.equal(2n);
  });

  it("Should revert when non-KYB store attempts to create vault", async function () {
    const { loanCore, unauthorized, poolEurcAddr } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(
      loanCore.connect(unauthorized).createVault(poolEurcAddr)
    ).to.be.revertedWithCustomError(loanCore, "KybRequired")
     .withArgs(unauthorized.address);
  });

  it("Should revert when creating vault with unregistered lending pool", async function () {
    const { loanCore, store, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(
      loanCore.connect(store).createVault(unauthorized.address)
    ).to.be.revertedWithCustomError(loanCore, "UnregisteredLendingPool")
     .withArgs(unauthorized.address);
  });

  it("Should enforce independent risk parameters across two distinct pools bound to different vaults", async function () {
    const { loanCore, poolFactory, admin, store, poolEurcAddr } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const weth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
    await poolFactory.connect(admin).createPool(
      await weth.getAddress(),
      "Pool WETH",
      "pWETH",
      4000n, // 40% Max LTV
      6000n, // 60% LT
      1200n, // 12% Penalty
      1000n  // 10% Borrow rate
    );
    const poolWethAddr = await poolFactory.getPool(await weth.getAddress());
    const poolWeth = await ethers.getContractAt("HoloFiLendingPool", poolWethAddr);
    await poolWeth.connect(admin).setLoanCore(await loanCore.getAddress());

    // Vault 1 bound to EURC pool (50% max LTV, 70% LT)
    await loanCore.connect(store).createVault(poolEurcAddr);

    // Vault 2 bound to WETH pool (40% max LTV, 60% LT)
    await loanCore.connect(store).createVault(poolWethAddr);

    const fmv = ethers.parseUnits("10000", 6);

    // Max borrow capacity check
    expect(await loanCore.getMaxBorrowCapacity(1n, fmv)).to.equal(ethers.parseUnits("5000", 6));
    expect(await loanCore.getMaxBorrowCapacity(2n, fmv)).to.equal(ethers.parseUnits("4000", 6));

    // Zero debt health factor check
    expect(await loanCore.getHealthFactor(1n, fmv)).to.equal(ethers.MaxUint256);
    expect(await loanCore.getHealthFactor(2n, fmv)).to.equal(ethers.MaxUint256);
  });

  it("Should calculate max borrow capacity correctly", async function () {
    const { loanCore, store, poolEurcAddr } = await networkHelpers.loadFixture(deployLoanCoreFixture);
    await loanCore.connect(store).createVault(poolEurcAddr);
    const fmv = ethers.parseUnits("10000", 6);
    expect(await loanCore.getMaxBorrowCapacity(1n, fmv)).to.equal(ethers.parseUnits("5000", 6));
  });

  it("Should calculate health factor correctly for zero debt and active debt", async function () {
    const { loanCore, store, poolEurcAddr, vaultCard, priceFeed, minter, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployLoanCoreFixture);
    await loanCore.connect(store).createVault(poolEurcAddr);
    await vaultCard.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await priceFeed.connect(minter).setBatchPrices(
      [cardTypeId1, cardTypeId2],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    const fmv = ethers.parseUnits("10000", 6);

    const zeroDebtHf = await loanCore.getHealthFactor(1n, fmv);
    expect(zeroDebtHf).to.equal(ethers.MaxUint256);

    // Borrow 5000 EURC
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("5000", 6));

    // HF = (10000 * 7000 * 1e18) / (5000 * 10000) = 1.4e18
    const safeHf = await loanCore.getHealthFactor(1n, fmv);
    expect(safeHf).to.equal(ethers.parseEther("1.4"));
  });

  it("Should allow oracle to set card FMVs, calculate vault FMV, and execute borrow from bound lending pool", async function () {
    const { loanCore, vaultCard, priceFeed, store, minter, poolEurcAddr, eurc, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await loanCore.connect(store).createVault(poolEurcAddr);
    await vaultCard.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await priceFeed.connect(minter).setBatchPrices(
      [cardTypeId1, cardTypeId2],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    expect(await loanCore.getVaultFMV(1n)).to.equal(ethers.parseUnits("10000", 6));

    const borrowAmount = ethers.parseUnits("4000", 6);

    await expect(loanCore.connect(store).borrow(1n, borrowAmount))
      .to.emit(loanCore, "BorrowExecuted")
      .withArgs(1n, store.address, poolEurcAddr, borrowAmount, borrowAmount);

    expect(await eurc.balanceOf(store.address)).to.equal(borrowAmount);
    expect(await eurc.balanceOf(poolEurcAddr)).to.equal(ethers.parseUnits("96000", 6));

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.equal(borrowAmount);
    expect(vaultInfo.lendingPool).to.equal(poolEurcAddr);

    await expect(
      loanCore.connect(store).borrow(1n, ethers.parseUnits("2000", 6))
    ).to.be.revertedWithCustomError(loanCore, "ExceedsMaxBorrowCapacity");
  });

  it("Should allow store to execute full loan repayment and release collateral NFTs", async function () {
    const { loanCore, vaultCard, priceFeed, store, minter, poolEurcAddr, eurc, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await loanCore.connect(store).createVault(poolEurcAddr);
    await vaultCard.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await priceFeed.connect(minter).setBatchPrices(
      [cardTypeId1, cardTypeId2],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    const borrowTx = await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6));
    const borrowBlock = await ethers.provider.getBlock(borrowTx.blockNumber!);
    const borrowTimestamp = borrowBlock!.timestamp;

    await eurc.mint(store.address, ethers.parseUnits("200", 6));
    await eurc.connect(store).approve(poolEurcAddr, ethers.MaxUint256);

    await networkHelpers.time.setNextBlockTimestamp(borrowTimestamp + 86400 * 365);

    const totalDebt = ethers.parseUnits("4200", 6);

    await expect(loanCore.connect(store).repay(1n, totalDebt))
      .to.emit(loanCore, "RepaymentExecuted")
      .withArgs(
        1n,
        store.address,
        poolEurcAddr,
        totalDebt,
        ethers.parseUnits("200", 6),
        ethers.parseUnits("4000", 6),
        0n,
        0n
      );

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.equal(0n);
    expect(vaultInfo.accumulatedInterest).to.equal(0n);
    expect(await eurc.balanceOf(poolEurcAddr)).to.equal(ethers.parseUnits("100200", 6));

    await expect(loanCore.connect(store).withdrawCollateral(1n, [1n, 2n]))
      .to.emit(loanCore, "CollateralWithdrawn")
      .withArgs(1n, store.address, [1n, 2n]);

    expect(await vaultCard.ownerOf(1n)).to.equal(store.address);
    expect(await vaultCard.ownerOf(2n)).to.equal(store.address);

    const card1Info = await vaultCard.getCard(1n);
    const card2Info = await vaultCard.getCard(2n);
    expect(card1Info.isLocked).to.be.false;
    expect(card2Info.isLocked).to.be.false;
  });

  it("Should allow store to withdraw excess collateral when remaining FMV satisfies LTV ratio", async function () {
    const { loanCore, vaultCard, priceFeed, store, minter, poolEurcAddr, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await loanCore.connect(store).createVault(poolEurcAddr);
    await vaultCard.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await priceFeed.connect(minter).setBatchPrices(
      [cardTypeId1, cardTypeId2],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    // Borrow $2,500 (total FMV = $10,000, max borrow = $5,000)
    await loanCore.connect(store).borrow(1n, ethers.parseUnits("2500", 6));

    // Attempt to withdraw card 1 ($6,000 FMV). Remaining FMV = $4,000 (max borrow = $2,000). Debt = $2,500 -> reverts
    await expect(
      loanCore.connect(store).withdrawCollateral(1n, [1n])
    ).to.be.revertedWithCustomError(loanCore, "InsufficientCollateralRatio");

    // Withdraw card 2 ($4,000 FMV). Remaining FMV = $6,000 (max borrow = $3,000). Debt = $2,500 -> succeeds
    await loanCore.connect(store).withdrawCollateral(1n, [2n]);

    expect(await vaultCard.ownerOf(2n)).to.equal(store.address);
  });

  it("Should allow store to execute atomic repayAndWithdraw to reduce debt and free collateral", async function () {
    const { loanCore, vaultCard, priceFeed, store, minter, poolEurcAddr, eurc, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await loanCore.connect(store).createVault(poolEurcAddr);
    await vaultCard.connect(store).setApprovalForAll(await loanCore.getAddress(), true);
    await loanCore.connect(store).depositCollateral(1n, [1n, 2n]);

    await priceFeed.connect(minter).setBatchPrices(
      [cardTypeId1, cardTypeId2],
      [ethers.parseUnits("6000", 6), ethers.parseUnits("4000", 6)]
    );

    await loanCore.connect(store).borrow(1n, ethers.parseUnits("4000", 6));

    await eurc.mint(store.address, ethers.parseUnits("2001", 6));
    await eurc.connect(store).approve(poolEurcAddr, ethers.parseUnits("2001", 6));

    // Repay $2,000 + accrued interest and withdraw card 1 ($6,000 FMV). Remaining debt <= $2,000, remaining FMV = $4,000 (max borrow = $2,000) -> succeeds
    const repayAmount = ethers.parseUnits("2000", 6) + 100n;
    await loanCore.connect(store).repayAndWithdraw(1n, repayAmount, [1n]);

    expect(await vaultCard.ownerOf(1n)).to.equal(store.address);

    const vaultInfo = await loanCore.getVault(1n);
    expect(vaultInfo.principalDebt).to.be.lte(ethers.parseUnits("2000", 6));
  });

  it("Should enforce GradeEligibilityPolicy in depositCollateral across restricted and open lending pools", async function () {
    const {
      loanCore,
      vaultCard,
      store,
      admin,
      minter,
      poolEurc,
      poolEurcAddr,
      poolFactory,
      acm,
    } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    // 1. Deploy PSA 10 policy and configure on poolEurc (Premium)
    const policy = await ethers.deployContract("GradeEligibilityPolicy", [
      await acm.getAddress(),
      "PSA",
      10n,
      0n,
    ]);
    await poolEurc.connect(admin).setEligibilityPolicy(await policy.getAddress());

    // 2. Register PSA 10 and PSA 9 cards
    const psa10Attrs = {
      game: "Pokemon",
      language: "EN",
      setName: "Base Set",
      cardName: "Charizard",
      cardNumber: "4/102",
      printing: "1st Edition",
      grader: "PSA",
      grade: "10",
    };
    const psa9Attrs = {
      game: "Pokemon",
      language: "EN",
      setName: "Base Set",
      cardName: "Blastoise",
      cardNumber: "2/102",
      printing: "1st Edition",
      grader: "PSA",
      grade: "9",
    };

    const psa10CardTypeId = await policy.computeCardTypeId(psa10Attrs);
    const psa9CardTypeId = await policy.computeCardTypeId(psa9Attrs);

    await policy.connect(minter).registerCardType(psa10Attrs);
    await policy.connect(minter).registerCardType(psa9Attrs);

    expect(await policy.isCardTypeEligible(psa10CardTypeId)).to.be.true;
    expect(await policy.isCardTypeEligible(psa9CardTypeId)).to.be.false;

    // 3. Mint tokens to store
    await vaultCard.connect(minter).mintCard(store.address, psa10CardTypeId, ethers.keccak256(ethers.toUtf8Bytes("att10")), "ipfs://10");
    await vaultCard.connect(minter).mintCard(store.address, psa9CardTypeId, ethers.keccak256(ethers.toUtf8Bytes("att9")), "ipfs://9");

    const psa10TokenId = 3n; // Since tokens 1 and 2 were minted in fixture
    const psa9TokenId = 4n;

    // 4. Create Vault 1 bound to Premium Pool (poolEurc)
    await loanCore.connect(store).createVault(poolEurcAddr);
    const vault1Id = 1n;

    await vaultCard.connect(store).setApprovalForAll(await loanCore.getAddress(), true);

    // 5. Depositing PSA 9 card into Premium Pool vault should REVERT with IneligibleCollateral
    await expect(
      loanCore.connect(store).depositCollateral(vault1Id, [psa9TokenId])
    ).to.be.revertedWithCustomError(loanCore, "IneligibleCollateral")
     .withArgs(psa9TokenId, psa9CardTypeId, poolEurcAddr);

    // 6. Depositing PSA 10 card into Premium Pool vault should SUCCEED
    await expect(
      loanCore.connect(store).depositCollateral(vault1Id, [psa10TokenId])
    ).to.emit(loanCore, "CollateralDeposited")
     .withArgs(vault1Id, store.address, [psa10TokenId]);

    // 7. Create Deluxe Pool with PSA <= 9 eligibility policy
    const deluxeAsset = await ethers.deployContract("MockERC20", ["Deluxe EURC", "dEURC", 6]);
    await poolFactory.connect(admin).createPool(
      await deluxeAsset.getAddress(),
      "Deluxe Pool EURC",
      "dEURC",
      4000n,
      7000n,
      1000n,
      800n
    );
    const deluxePoolAddr = await poolFactory.getPool(await deluxeAsset.getAddress());
    const deluxePool = await ethers.getContractAt("HoloFiLendingPool", deluxePoolAddr);
    await deluxePool.connect(admin).setLoanCore(await loanCore.getAddress());

    const deluxePolicy = await ethers.deployContract("GradeEligibilityPolicy", [
      await acm.getAddress(),
      "PSA",
      0n,
      9n,
    ]);
    await deluxePool.connect(admin).setEligibilityPolicy(await deluxePolicy.getAddress());

    // Register both cards in deluxe policy
    await deluxePolicy.connect(minter).registerCardType(psa10Attrs);
    await deluxePolicy.connect(minter).registerCardType(psa9Attrs);

    // 8. Create Vault 2 bound to Deluxe Pool
    await loanCore.connect(store).createVault(deluxePoolAddr);
    const vault2Id = 2n;

    // 9. Depositing PSA 9 card into Deluxe Pool vault should SUCCEED
    await expect(
      loanCore.connect(store).depositCollateral(vault2Id, [psa9TokenId])
    ).to.emit(loanCore, "CollateralDeposited")
     .withArgs(vault2Id, store.address, [psa9TokenId]);

    // 10. Mint second PSA 10 card and depositing into Deluxe Pool vault should REVERT with IneligibleCollateral
    await vaultCard.connect(minter).mintCard(store.address, psa10CardTypeId, ethers.keccak256(ethers.toUtf8Bytes("att10_2")), "ipfs://10_2");
    const psa10TokenId2 = 5n;

    await expect(
      loanCore.connect(store).depositCollateral(vault2Id, [psa10TokenId2])
    ).to.be.revertedWithCustomError(loanCore, "IneligibleCollateral")
     .withArgs(psa10TokenId2, psa10CardTypeId, deluxePoolAddr);
  });
});
