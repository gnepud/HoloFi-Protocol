import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("AccessControlManager Integration Tests", function () {
  async function deployAcmFixture() {
    const [owner, admin, oracle, kybManager, pauser, user] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    return { acm, owner, admin, oracle, kybManager, pauser, user };
  }

  it("Should set up initial roles correctly", async function () {
    const { acm, admin } = await networkHelpers.loadFixture(deployAcmFixture);
    const defaultAdminRole = await acm.DEFAULT_ADMIN_ROLE();
    const adminRole = await acm.ADMIN_ROLE();

    expect(await acm.hasRole(defaultAdminRole, admin.address)).to.be.true;
    expect(await acm.hasRole(adminRole, admin.address)).to.be.true;
  });

  it("Should configure MINTER_ROLE correctly under ADMIN_ROLE", async function () {
    const { acm, admin, user } = await networkHelpers.loadFixture(deployAcmFixture);
    const minterRole = await acm.MINTER_ROLE();
    await acm.connect(admin).grantRole(minterRole, user.address);
    expect(await acm.hasRole(minterRole, user.address)).to.be.true;
  });

  it("Should revert if deployed with zero address admin", async function () {
    await expect(
      ethers.deployContract("AccessControlManager", [ethers.ZeroAddress])
    ).to.be.revertedWithCustomError(
      await ethers.getContractFactory("AccessControlManager"),
      "ZeroAddressAdmin"
    );
  });

  it("Should allow admin to grant and revoke roles and emit events", async function () {
    const { acm, admin, oracle } = await networkHelpers.loadFixture(deployAcmFixture);
    const oracleRole = await acm.ORACLE_ROLE();

    await expect(acm.connect(admin).grantRole(oracleRole, oracle.address))
      .to.emit(acm, "RoleGranted")
      .withArgs(oracleRole, oracle.address, admin.address);

    expect(await acm.hasRole(oracleRole, oracle.address)).to.be.true;

    await expect(acm.connect(admin).revokeRole(oracleRole, oracle.address))
      .to.emit(acm, "RoleRevoked")
      .withArgs(oracleRole, oracle.address, admin.address);

    expect(await acm.hasRole(oracleRole, oracle.address)).to.be.false;
  });

  it("Should revert when non-admin attempts to grant roles", async function () {
    const { acm, user, oracle } = await networkHelpers.loadFixture(deployAcmFixture);
    const oracleRole = await acm.ORACLE_ROLE();
    const adminRole = await acm.ADMIN_ROLE();

    await expect(acm.connect(user).grantRole(oracleRole, oracle.address))
      .to.be.revertedWithCustomError(acm, "AccessControlUnauthorizedAccount")
      .withArgs(user.address, adminRole);
  });

  it("Should allow KYB manager or admin to update KYB status and emit event", async function () {
    const { acm, admin, kybManager, user } = await networkHelpers.loadFixture(deployAcmFixture);
    const kybRole = await acm.KYB_MANAGER_ROLE();
    await acm.connect(admin).grantRole(kybRole, kybManager.address);

    await expect(acm.connect(kybManager).setKybStatus(user.address, true))
      .to.emit(acm, "KybStatusUpdated")
      .withArgs(user.address, true, kybManager.address);

    expect(await acm.isKybApproved(user.address)).to.be.true;
  });

  it("Should allow batch KYB status updates", async function () {
    const { acm, admin, user, oracle } = await networkHelpers.loadFixture(deployAcmFixture);

    await acm.connect(admin).setKybStatusBatch([user.address, oracle.address], true);

    expect(await acm.isKybApproved(user.address)).to.be.true;
    expect(await acm.isKybApproved(oracle.address)).to.be.true;
  });

  it("Should revert when unauthorized user attempts to set KYB status", async function () {
    const { acm, user, oracle } = await networkHelpers.loadFixture(deployAcmFixture);

    await expect(acm.connect(user).setKybStatus(oracle.address, true))
      .to.be.revertedWithCustomError(acm, "UnauthorizedKybOperator")
      .withArgs(user.address);
  });

  it("Should revert when setting KYB status for zero address", async function () {
    const { acm, admin } = await networkHelpers.loadFixture(deployAcmFixture);

    await expect(
      acm.connect(admin).setKybStatus(ethers.ZeroAddress, true)
    ).to.be.revertedWithCustomError(acm, "ZeroAddressKybAccount");
  });
});

