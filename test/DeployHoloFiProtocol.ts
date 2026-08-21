import { expect } from "chai";
import { network } from "hardhat";
import DeployHoloFiProtocol from "../ignition/modules/DeployHoloFiProtocol.js";
import DeployHoloFiLendingPoolWithMock from "../ignition/modules/DeployHoloFiLendingPoolWithMock.js";
import DeployHoloFiLendingPool from "../ignition/modules/DeployHoloFiLendingPool.js";
import DeployHoloFiFullProtocol from "../ignition/modules/DeployHoloFiFullProtocol.js";

const { ethers, ignition } = await network.create();

describe("Hardhat Ignition Deployment Verification Suite", function () {
  it("Should deploy full HoloFi protocol via Ignition and verify interconnectivity and role assignments", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const { acm, vaultCard, priceFeed, poolFactory, loanCore, dutchAuction } = await ignition.deploy(
      DeployHoloFiProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
        },
      }
    );

    const acmAddr = await acm.getAddress();
    const vaultCardAddr = await vaultCard.getAddress();
    const priceFeedAddr = await priceFeed.getAddress();
    const poolFactoryAddr = await poolFactory.getAddress();
    const loanCoreAddr = await loanCore.getAddress();
    const dutchAuctionAddr = await dutchAuction.getAddress();

    // Verify non-zero contract addresses
    expect(acmAddr).to.not.equal(ethers.ZeroAddress);
    expect(vaultCardAddr).to.not.equal(ethers.ZeroAddress);
    expect(priceFeedAddr).to.not.equal(ethers.ZeroAddress);
    expect(poolFactoryAddr).to.not.equal(ethers.ZeroAddress);
    expect(loanCoreAddr).to.not.equal(ethers.ZeroAddress);
    expect(dutchAuctionAddr).to.not.equal(ethers.ZeroAddress);

    // Verify LoanCore contract references
    expect(await loanCore.acm()).to.equal(acmAddr);
    expect(await loanCore.vaultCard()).to.equal(vaultCardAddr);
    expect(await loanCore.poolFactory()).to.equal(poolFactoryAddr);
    expect(await loanCore.priceFeed()).to.equal(priceFeedAddr);
    expect(await loanCore.dutchAuction()).to.equal(dutchAuctionAddr);

    // Verify DutchAuction contract references
    expect(await dutchAuction.acm()).to.equal(acmAddr);
    expect(await dutchAuction.loanCore()).to.equal(loanCoreAddr);
    expect(await dutchAuction.poolFactory()).to.equal(poolFactoryAddr);
    expect(await dutchAuction.treasury()).to.equal(treasury.address);

    // Verify role authorizations via ACM
    const ADMIN_ROLE = await acm.ADMIN_ROLE();
    const LOCKER_ROLE = await acm.LOCKER_ROLE();
    const ORACLE_ROLE = await acm.ORACLE_ROLE();
    const MINTER_ROLE = await acm.MINTER_ROLE();

    expect(await acm.hasRole(LOCKER_ROLE, loanCoreAddr)).to.be.true;
    expect(await acm.hasRole(ADMIN_ROLE, loanCoreAddr)).to.be.false;
    expect(await acm.hasRole(ORACLE_ROLE, oracleFeeder.address)).to.be.true;
    expect(await acm.hasRole(MINTER_ROLE, minter.address)).to.be.true;
  });

  it("Should allow KYB store to deposit collateral into loanCore deployed via Ignition without UnauthorizedLockOperator revert", async function () {
    const [admin, oracleFeeder, minter, treasury, store] = await ethers.getSigners();

    const { acm, vaultCard, loanCore, poolFactory } = await ignition.deploy(
      DeployHoloFiProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
        },
      }
    );

    const acmContract = acm as any;
    const vaultCardContract = vaultCard as any;
    const loanCoreContract = loanCore as any;
    const poolFactoryContract = poolFactory as any;

    // Approve KYB status for store
    await acmContract.connect(admin).setKybStatus(store.address, true);

    // Deploy a mock asset and create a valid lending pool for vault binding
    const mockAsset = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    await poolFactoryContract.connect(admin).createPool(
      await mockAsset.getAddress(),
      "Premium Pool EURC",
      "pEURC",
      5000n,
      7000n,
      1000n,
      500n
    );
    const poolAddr = await poolFactoryContract.poolsByAsset(await mockAsset.getAddress(), 0n);

    // Mint card NFT to store
    const cardTypeId = ethers.keccak256(ethers.toUtf8Bytes("Charizard_1st_Edition"));
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attestation_raw"));
    await vaultCardContract.connect(minter).mintCard(store.address, cardTypeId, attestationHash, "ipfs://card1");

    // Store creates vault, approves loanCore, and deposits collateral
    await loanCoreContract.connect(store).createVault(poolAddr);
    const loanCoreAddr = await loanCore.getAddress();
    await vaultCardContract.connect(store).setApprovalForAll(loanCoreAddr, true);

    // Deposit collateral (triggers vaultCard.setCardLock which requires ADMIN_ROLE on loanCore)
    await expect(loanCoreContract.connect(store).depositCollateral(1n, [1n]))
      .to.emit(loanCore, "CollateralDeposited")
      .withArgs(1n, store.address, [1n]);

    expect(await vaultCardContract.ownerOf(1n)).to.equal(loanCoreAddr);
    const cardInfo = await vaultCardContract.getCard(1n);
    expect(cardInfo.isLocked).to.be.true;
  });

  it("Should deploy full protocol with 2 default mock pools (Premium & Deluxe) via DeployHoloFiFullProtocol", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const { loanCore, poolFactory, premiumLendingPool, deluxeLendingPool, mockAsset } = await ignition.deploy(
      DeployHoloFiFullProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
          DeployHoloFiLendingPoolWithMock: {
            mockMintAmount: 10_000_000_000_000n, // 10,000,000 EURC
          },
        },
      }
    );

    const premiumPoolAddr = await premiumLendingPool.getAddress();
    const deluxePoolAddr = await deluxeLendingPool.getAddress();
    const mockAssetAddr = await mockAsset.getAddress();
    const loanCoreAddr = await loanCore.getAddress();
    const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

    expect(premiumPoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(deluxePoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(premiumPoolAddr).to.not.equal(deluxePoolAddr);

    expect(await poolFactory.isValidPool(premiumPoolAddr)).to.be.true;
    expect(await poolFactory.isValidPool(deluxePoolAddr)).to.be.true;

    // Verify Premium Pool parameters
    const premiumContract = premiumLendingPool as any;
    expect(await premiumContract.name()).to.equal("Premium Pool EURC");
    expect(await premiumContract.symbol()).to.equal("pEURC");
    expect(await premiumContract.maxLtvBps()).to.equal(5000n);
    expect(await premiumContract.liquidationThresholdBps()).to.equal(7000n);
    expect(await premiumContract.liquidationPenaltyBps()).to.equal(1000n);
    expect(await premiumContract.borrowRateBpsPerYear()).to.equal(500n);
    expect(await premiumContract.loanCore()).to.equal(loanCoreAddr);
    expect(await premiumContract.eligibilityPolicy()).to.not.equal(ethers.ZeroAddress);

    // Verify Premium Policy parameters (Exact PSA 10)
    const premiumPolicy = await ethers.getContractAt("GradeEligibilityPolicy", await premiumContract.eligibilityPolicy());
    expect(await premiumPolicy.requiredGrader()).to.equal("PSA");
    expect(await premiumPolicy.minGrade()).to.equal(10n);
    expect(await premiumPolicy.maxGrade()).to.equal(10n);

    // Verify Deluxe Pool parameters
    const deluxeContract = deluxeLendingPool as any;
    expect(await deluxeContract.name()).to.equal("Deluxe Pool EURC");
    expect(await deluxeContract.symbol()).to.equal("dEURC");
    expect(await deluxeContract.maxLtvBps()).to.equal(4000n);
    expect(await deluxeContract.liquidationThresholdBps()).to.equal(7000n);
    expect(await deluxeContract.liquidationPenaltyBps()).to.equal(1000n);
    expect(await deluxeContract.borrowRateBpsPerYear()).to.equal(800n);
    expect(await deluxeContract.loanCore()).to.equal(loanCoreAddr);
    expect(await deluxeContract.eligibilityPolicy()).to.not.equal(ethers.ZeroAddress);

    // Verify Deluxe Policy parameters (Exact PSA 9)
    const deluxePolicy = await ethers.getContractAt("GradeEligibilityPolicy", await deluxeContract.eligibilityPolicy());
    expect(await deluxePolicy.requiredGrader()).to.equal("PSA");
    expect(await deluxePolicy.minGrade()).to.equal(9n);
    expect(await deluxePolicy.maxGrade()).to.equal(9n);

    // Verify 10M EURC total split evenly (5M EURC in each pool)
    expect(await (mockAsset as any).balanceOf(premiumPoolAddr)).to.equal(5_000_000_000_000n);
    expect(await (mockAsset as any).balanceOf(deluxePoolAddr)).to.equal(5_000_000_000_000n);

    // Verify ERC-4626 balanced accounting and locked seed liquidity in both pools (with 3-decimal offset: 9 decimals)
    expect(await premiumContract.totalAssets()).to.equal(5_000_000_000_000n);
    expect(await premiumContract.totalSupply()).to.equal(5_000_000_000_000_000n);
    expect(await premiumContract.balanceOf(DEAD_ADDRESS)).to.equal(5_000_000_000_000_000n);

    expect(await deluxeContract.totalAssets()).to.equal(5_000_000_000_000n);
    expect(await deluxeContract.totalSupply()).to.equal(5_000_000_000_000_000n);
    expect(await deluxeContract.balanceOf(DEAD_ADDRESS)).to.equal(5_000_000_000_000_000n);

    // Verify subsequent user deposit receives exact shares in Premium Pool (9 decimals)
    const [_, __, ___, ____, lpUser] = await ethers.getSigners();
    const userDepositAmount = 1_000_000_000n; // 1,000 EURC
    await (mockAsset as any).mint(lpUser.address, userDepositAmount);
    await (mockAsset as any).connect(lpUser).approve(premiumPoolAddr, userDepositAmount);
    await premiumContract.connect(lpUser).deposit(userDepositAmount, lpUser.address);

    expect(await premiumContract.balanceOf(lpUser.address)).to.equal(1_000_000_000_000n);
  });

  it("Should deploy 2 default lending pools targeting an existing ERC20 asset via DeployHoloFiLendingPool", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const existingAsset = await MockERC20.deploy("Existing EURC", "eEURC", 6);
    await existingAsset.waitForDeployment();
    const assetAddr = await existingAsset.getAddress();

    const { loanCore, poolFactory, premiumLendingPool, deluxeLendingPool } = await ignition.deploy(
      DeployHoloFiLendingPool,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
          DeployHoloFiLendingPool: {
            existingAssetAddress: assetAddr,
          },
        },
      }
    );

    const premiumPoolAddr = await premiumLendingPool.getAddress();
    const deluxePoolAddr = await deluxeLendingPool.getAddress();
    const loanCoreAddr = await loanCore.getAddress();

    expect(await poolFactory.isValidPool(premiumPoolAddr)).to.be.true;
    expect(await poolFactory.isValidPool(deluxePoolAddr)).to.be.true;
    expect(await (premiumLendingPool as any).loanCore()).to.equal(loanCoreAddr);
    expect(await (premiumLendingPool as any).asset()).to.equal(assetAddr);
    expect(await (deluxeLendingPool as any).loanCore()).to.equal(loanCoreAddr);
    expect(await (deluxeLendingPool as any).asset()).to.equal(assetAddr);
  });
});
