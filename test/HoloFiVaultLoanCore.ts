import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiVaultLoanCore Integration Tests", function () {
  async function deployLoanCoreFixture() {
    const [owner, admin, minter, store, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const cardCollection = await ethers.deployContract("HoloFiCardCollection", [
      "HoloFi TCG Cards",
      "HFC",
      await acm.getAddress(),
    ]);
    const loanCore = await ethers.deployContract("HoloFiVaultLoanCore", [
      await acm.getAddress(),
      await cardCollection.getAddress(),
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

    return { acm, cardCollection, loanCore, owner, admin, minter, store, unauthorized };
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
});
