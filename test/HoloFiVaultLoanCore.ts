import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiVaultLoanCore Integration Tests", function () {
  async function deployLoanCoreFixture() {
    const [owner, admin, minter, boutique, unauthorized] = await ethers.getSigners();
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
    await acm.connect(admin).setKybStatus(boutique.address, true);

    const attestationHash1 = ethers.keccak256(ethers.toUtf8Bytes("attestation1"));
    const attestationHash2 = ethers.keccak256(ethers.toUtf8Bytes("attestation2"));

    await cardCollection.connect(minter).mintCard(boutique.address, attestationHash1, "ipfs://card1");
    await cardCollection.connect(minter).mintCard(boutique.address, attestationHash2, "ipfs://card2");

    return { acm, cardCollection, loanCore, owner, admin, minter, boutique, unauthorized };
  }

  it("Should allow KYB approved boutique to create vault and escrow/withdraw cards", async function () {
    const { cardCollection, loanCore, boutique } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const loanCoreAddr = await loanCore.getAddress();

    await expect(loanCore.connect(boutique).createVault())
      .to.emit(loanCore, "VaultCreated")
      .withArgs(1n, boutique.address);

    await cardCollection.connect(boutique).setApprovalForAll(loanCoreAddr, true);

    await expect(loanCore.connect(boutique).depositCollateral(1n, [1n, 2n]))
      .to.emit(loanCore, "CollateralDeposited")
      .withArgs(1n, boutique.address, [1n, 2n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(loanCoreAddr);
    expect(await cardCollection.ownerOf(2n)).to.equal(loanCoreAddr);

    const card1Info = await cardCollection.getCard(1n);
    expect(card1Info.isLocked).to.be.true;

    await expect(loanCore.connect(boutique).withdrawCollateral(1n, [1n]))
      .to.emit(loanCore, "CollateralWithdrawn")
      .withArgs(1n, boutique.address, [1n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(boutique.address);

    const card1InfoUnlocked = await cardCollection.getCard(1n);
    expect(card1InfoUnlocked.isLocked).to.be.false;

    const remainingTokens = await loanCore.getVaultTokenIds(1n);
    expect(remainingTokens.length).to.equal(1);
    expect(remainingTokens[0]).to.equal(2n);
  });

  it("Should revert when non-KYB boutique attempts to create vault", async function () {
    const { loanCore, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(
      loanCore.connect(unauthorized).createVault()
    ).to.be.revertedWithCustomError(loanCore, "KybRequired")
     .withArgs(unauthorized.address);
  });
});
