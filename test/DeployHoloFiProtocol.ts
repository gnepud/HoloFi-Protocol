import { expect } from "chai";
import { network } from "hardhat";
import DeployHoloFiProtocol from "../ignition/modules/DeployHoloFiProtocol.js";
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
    const ORACLE_ROLE = await acm.ORACLE_ROLE();
    const MINTER_ROLE = await acm.MINTER_ROLE();

    expect(await acm.hasRole(ADMIN_ROLE, loanCoreAddr)).to.be.true;
    expect(await acm.hasRole(ORACLE_ROLE, oracleFeeder.address)).to.be.true;
    expect(await acm.hasRole(MINTER_ROLE, minter.address)).to.be.true;
  });

  it("Should allow KYB store to deposit collateral into loanCore deployed via Ignition without UnauthorizedLockOperator revert", async function () {
    const [admin, oracleFeeder, minter, treasury, store] = await ethers.getSigners();

    const { acm, vaultCard, loanCore } = await ignition.deploy(
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

    // Approve KYB status for store
    await acmContract.connect(admin).setKybStatus(store.address, true);

    // Mint card NFT to store
    const cardTypeId = ethers.keccak256(ethers.toUtf8Bytes("Charizard_1st_Edition"));
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attestation_raw"));
    await vaultCardContract.connect(minter).mintCard(store.address, cardTypeId, attestationHash, "ipfs://card1");

    // Store creates vault, approves loanCore, and deposits collateral
    await loanCoreContract.connect(store).createVault();
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

  it("Should deploy full protocol with mock token lending pool via DeployHoloFiFullProtocol (useMockToken: true)", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const { loanCore, poolFactory, lendingPool, mockAsset } = await ignition.deploy(
      DeployHoloFiFullProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
          DeployHoloFiLendingPool: {
            useMockToken: true,
            mockMintAmount: 1000000000000n,
            poolName: "Pool EURC",
            poolSymbol: "pEURC",
          },
        },
      }
    );

    const lendingPoolAddr = await lendingPool.getAddress();
    const mockAssetAddr = await mockAsset.getAddress();
    const loanCoreAddr = await loanCore.getAddress();

    expect(lendingPoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(mockAssetAddr).to.not.equal(ethers.ZeroAddress);
    expect(await poolFactory.isValidPool(lendingPoolAddr)).to.be.true;
    expect(await lendingPool.loanCore()).to.equal(loanCoreAddr);
    expect(await mockAsset.balanceOf(lendingPoolAddr)).to.equal(1_000_000_000_000n);
  });

  it("Should deploy full protocol with existing asset lending pool via DeployHoloFiFullProtocol (useMockToken: false)", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const existingAsset = await MockERC20.deploy("Existing EURC", "eEURC", 6);
    await existingAsset.waitForDeployment();
    const assetAddr = await existingAsset.getAddress();

    const { loanCore, poolFactory, lendingPool } = await ignition.deploy(
      DeployHoloFiFullProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
          DeployHoloFiLendingPool: {
            useMockToken: false,
            existingAssetAddress: assetAddr,
            poolName: "Pool eEURC",
            poolSymbol: "peEURC",
          },
        },
      }
    );

    const lendingPoolAddr = await lendingPool.getAddress();
    const loanCoreAddr = await loanCore.getAddress();

    expect(await poolFactory.getPool(assetAddr)).to.equal(lendingPoolAddr);
    expect(await lendingPool.loanCore()).to.equal(loanCoreAddr);
    expect(await lendingPool.asset()).to.equal(assetAddr);
  });
});

