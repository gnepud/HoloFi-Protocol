import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiVaultCard Integration Tests", function () {
  async function deployVaultCardFixture() {
    const [owner, admin, minter, user, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const minterRole = await acm.MINTER_ROLE();
    await acm.connect(admin).grantRole(minterRole, minter.address);

    const vaultCard = await ethers.deployContract("HoloFiVaultCard", [
      "HoloFi TCG Cards",
      "HFC",
      await acm.getAddress(),
    ]);

    return { acm, vaultCard, owner, admin, minter, user, unauthorized };
  }

  it("Should allow minter to mint card and emit CardMinted event", async function () {
    const { vaultCard, minter, user } = await networkHelpers.loadFixture(deployVaultCardFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:PSA:10:999"));
    const tokenUri = "ipfs://QmTestURI";

    await expect(vaultCard.connect(minter).mintCard(user.address, attestationHash, tokenUri))
      .to.emit(vaultCard, "CardMinted")
      .withArgs(1n, user.address, attestationHash, tokenUri);

    expect(await vaultCard.ownerOf(1n)).to.equal(user.address);
    expect(await vaultCard.tokenURI(1n)).to.equal(tokenUri);

    const card = await vaultCard.getCard(1n);
    expect(card.tokenId).to.equal(1n);
    expect(card.attestationHash).to.equal(attestationHash);
    expect(card.isLocked).to.be.false;
    expect(card.mintTimestamp).to.be.greaterThan(0n);
  });

  it("Should verify raw attestation data correctly", async function () {
    const { vaultCard, minter, user } = await networkHelpers.loadFixture(deployVaultCardFixture);
    const rawData = ethers.toUtf8Bytes("Blink:PSA:10:999");
    const attestationHash = ethers.keccak256(rawData);

    await vaultCard.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");

    expect(await vaultCard.verifyAttestation(1n, rawData)).to.be.true;
    expect(await vaultCard.verifyAttestation(1n, ethers.toUtf8Bytes("WrongData"))).to.be.false;
  });

  it("Should allow admin to update card lock status", async function () {
    const { vaultCard, admin, minter, user } = await networkHelpers.loadFixture(deployVaultCardFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await vaultCard.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");

    await expect(vaultCard.connect(admin).setCardLock(1n, true))
      .to.emit(vaultCard, "CardLockUpdated")
      .withArgs(1n, true);

    const card = await vaultCard.getCard(1n);
    expect(card.isLocked).to.be.true;
  });

  it("Should revert when unauthorized user attempts to mint", async function () {
    const { vaultCard, unauthorized, user } = await networkHelpers.loadFixture(deployVaultCardFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await expect(
      vaultCard.connect(unauthorized).mintCard(user.address, attestationHash, "ipfs://QmURI")
    ).to.be.revertedWithCustomError(vaultCard, "UnauthorizedMinter")
      .withArgs(unauthorized.address);
  });

  it("Should allow unlocked card transfers freely between wallets", async function () {
    const { vaultCard, minter, user, unauthorized } = await networkHelpers.loadFixture(deployVaultCardFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await vaultCard.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");

    await vaultCard.connect(user).transferFrom(user.address, unauthorized.address, 1n);
    expect(await vaultCard.ownerOf(1n)).to.equal(unauthorized.address);
  });

  it("Should revert transfer of locked card with custom error CardIsLocked", async function () {
    const { vaultCard, admin, minter, user, unauthorized } = await networkHelpers.loadFixture(deployVaultCardFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await vaultCard.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");
    await vaultCard.connect(admin).setCardLock(1n, true);

    await expect(
      vaultCard.connect(user).transferFrom(user.address, unauthorized.address, 1n)
    ).to.be.revertedWithCustomError(vaultCard, "CardIsLocked")
     .withArgs(1n);

    await vaultCard.connect(admin).setCardLock(1n, false);
    await vaultCard.connect(user).transferFrom(user.address, unauthorized.address, 1n);
    expect(await vaultCard.ownerOf(1n)).to.equal(unauthorized.address);
  });
});
