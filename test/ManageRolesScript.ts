import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";
import {
  parseCliArgs,
  resolveRoleHash,
  getRoleNameFromHash,
  resolveAcmAddress,
  getAcmContract,
  checkRoles,
  formatRoleTable,
  grantRole,
  revokeRole,
  KNOWN_ROLES,
} from "../scripts/manage-roles.js";

const { ethers, networkHelpers } = await network.create();

describe("ManageRoles CLI Script Integration Tests", function () {
  async function deployAcmFixture() {
    const [admin, operator, user] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    return { acm, admin, operator, user };
  }

  describe("parseCliArgs", function () {
    it("Should parse 'check' action with target address", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "check", target]);
      expect(parsed.action).to.equal("check");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.roleName).to.be.undefined;
      expect(parsed.acmAddress).to.be.undefined;
    });

    it("Should parse 'grant' action with target address and role", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "grant", target, "ORACLE_ROLE"]);
      expect(parsed.action).to.equal("grant");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.roleName).to.equal("ORACLE_ROLE");
    });

    it("Should parse 'revoke' action with target address and role", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "revoke", target, "minter"]);
      expect(parsed.action).to.equal("revoke");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.roleName).to.equal("minter");
    });

    it("Should parse positional custom ACM address for check action", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const customAcm = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "check", target, customAcm]);
      expect(parsed.action).to.equal("check");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.acmAddress).to.equal(customAcm);
    });

    it("Should parse positional custom ACM address for grant action", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const customAcm = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "grant", target, "oracle", customAcm]);
      expect(parsed.action).to.equal("grant");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.roleName).to.equal("oracle");
      expect(parsed.acmAddress).to.equal(customAcm);
    });

    it("Should parse arguments after double dash '--'", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs([
        "node",
        "hardhat",
        "run",
        "scripts/manage-roles.ts",
        "--network",
        "localhost",
        "--",
        "grant",
        target,
        "pauser",
      ]);
      expect(parsed.action).to.equal("grant");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.roleName).to.equal("pauser");
    });

    it("Should parse --acm option flag", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const customAcm = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "--acm", customAcm, "check", target]);
      expect(parsed.action).to.equal("check");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.acmAddress).to.equal(customAcm);
    });

    it("Should parse --help flag", function () {
      const parsed = parseCliArgs(["node", "manage-roles.ts", "--help"]);
      expect(parsed.help).to.be.true;
    });
  });

  describe("resolveRoleHash & getRoleNameFromHash", function () {
    it("Should resolve canonical role names", function () {
      expect(resolveRoleHash("DEFAULT_ADMIN_ROLE")).to.equal(ethersLib.ZeroHash);
      expect(resolveRoleHash("ADMIN_ROLE")).to.equal(ethersLib.id("ADMIN_ROLE"));
      expect(resolveRoleHash("ORACLE_ROLE")).to.equal(ethersLib.id("ORACLE_ROLE"));
      expect(resolveRoleHash("MINTER_ROLE")).to.equal(ethersLib.id("MINTER_ROLE"));
      expect(resolveRoleHash("KYB_MANAGER_ROLE")).to.equal(ethersLib.id("KYB_MANAGER_ROLE"));
      expect(resolveRoleHash("PAUSER_ROLE")).to.equal(ethersLib.id("PAUSER_ROLE"));
    });

    it("Should resolve aliases in various cases", function () {
      expect(resolveRoleHash("root")).to.equal(ethersLib.ZeroHash);
      expect(resolveRoleHash("zero")).to.equal(ethersLib.ZeroHash);
      expect(resolveRoleHash("default_admin")).to.equal(ethersLib.ZeroHash);
      expect(resolveRoleHash("admin")).to.equal(ethersLib.id("ADMIN_ROLE"));
      expect(resolveRoleHash("oracle")).to.equal(ethersLib.id("ORACLE_ROLE"));
      expect(resolveRoleHash("feeder")).to.equal(ethersLib.id("ORACLE_ROLE"));
      expect(resolveRoleHash("price_feeder")).to.equal(ethersLib.id("ORACLE_ROLE"));
      expect(resolveRoleHash("minter")).to.equal(ethersLib.id("MINTER_ROLE"));
      expect(resolveRoleHash("kyb")).to.equal(ethersLib.id("KYB_MANAGER_ROLE"));
      expect(resolveRoleHash("kyb_manager")).to.equal(ethersLib.id("KYB_MANAGER_ROLE"));
      expect(resolveRoleHash("pauser")).to.equal(ethersLib.id("PAUSER_ROLE"));
    });

    it("Should resolve raw 32-byte hex hash string", function () {
      const rawHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      expect(resolveRoleHash(rawHash)).to.equal(rawHash);
    });

    it("Should throw for unknown role string", function () {
      expect(() => resolveRoleHash("INVALID_ROLE")).to.throw("Unknown role");
    });

    it("Should map hash back to canonical name via getRoleNameFromHash", function () {
      expect(getRoleNameFromHash(ethersLib.ZeroHash)).to.equal("DEFAULT_ADMIN_ROLE");
      expect(getRoleNameFromHash(ethersLib.id("ADMIN_ROLE"))).to.equal("ADMIN_ROLE");
      expect(getRoleNameFromHash(ethersLib.id("ORACLE_ROLE"))).to.equal("ORACLE_ROLE");
      expect(getRoleNameFromHash(ethersLib.id("MINTER_ROLE"))).to.equal("MINTER_ROLE");
      expect(getRoleNameFromHash(ethersLib.id("KYB_MANAGER_ROLE"))).to.equal("KYB_MANAGER_ROLE");
      expect(getRoleNameFromHash(ethersLib.id("PAUSER_ROLE"))).to.equal("PAUSER_ROLE");

      const unknownHash = "0x9999999999999999999999999999999999999999999999999999999999999999";
      expect(getRoleNameFromHash(unknownHash)).to.equal(unknownHash);
    });
  });

  describe("resolveAcmAddress", function () {
    it("Should prioritize CLI ACM address when valid", async function () {
      const customAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const resolved = await resolveAcmAddress(ethers.provider, customAddr);
      expect(resolved).to.equal(customAddr);
    });

    it("Should resolve from ACM_ADDRESS environment variable", async function () {
      const customAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      process.env.ACM_ADDRESS = customAddr;
      try {
        const resolved = await resolveAcmAddress(ethers.provider);
        expect(resolved).to.equal(customAddr);
      } finally {
        delete process.env.ACM_ADDRESS;
      }
    });

    it("Should throw error if ACM address cannot be resolved", async function () {
      const savedAcm = process.env.ACM_ADDRESS;
      const savedAcmMgr = process.env.ACCESS_CONTROL_MANAGER_ADDRESS;
      delete process.env.ACM_ADDRESS;
      delete process.env.ACCESS_CONTROL_MANAGER_ADDRESS;

      try {
        let threw = false;
        try {
          await resolveAcmAddress(ethers.provider, undefined, "/non/existent/dir");
        } catch (err: any) {
          threw = true;
          expect(err.message).to.include("Could not resolve AccessControlManager address");
        }
        expect(threw, "Expected resolveAcmAddress to throw").to.be.true;
      } finally {
        if (savedAcm) process.env.ACM_ADDRESS = savedAcm;
        if (savedAcmMgr) process.env.ACCESS_CONTROL_MANAGER_ADDRESS = savedAcmMgr;
      }
    });
  });

  describe("checkRoles and getAcmContract", function () {
    it("Should verify role check result structure for admin account", async function () {
      const { acm, admin } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      const result = await checkRoles(acmContract, admin.address);
      expect(result.targetAddress).to.equal(admin.address);
      expect(result.acmAddress).to.equal(await acm.getAddress());
      expect(result.isKybApproved).to.be.false;
      expect(result.roles).to.have.length(KNOWN_ROLES.length);

      const adminRoleStatus = result.roles.find((r) => r.name === "ADMIN_ROLE");
      const defaultAdminStatus = result.roles.find((r) => r.name === "DEFAULT_ADMIN_ROLE");
      const minterRoleStatus = result.roles.find((r) => r.name === "MINTER_ROLE");

      expect(adminRoleStatus?.granted).to.be.true;
      expect(defaultAdminStatus?.granted).to.be.true;
      expect(minterRoleStatus?.granted).to.be.false;
    });

    it("Should verify role check result for unprivileged account and reflect KYB status", async function () {
      const { acm, admin, user } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      const initialResult = await checkRoles(acmContract, user.address);
      expect(initialResult.targetAddress).to.equal(user.address);
      expect(initialResult.isKybApproved).to.be.false;
      expect(initialResult.roles.every((r) => !r.granted)).to.be.true;

      // Admin approves KYB for user
      await acm.connect(admin).setKybStatus(user.address, true);

      const updatedResult = await checkRoles(acmContract, user.address);
      expect(updatedResult.isKybApproved).to.be.true;
    });
  });

  describe("grantRole and revokeRole helpers", function () {
    it("Should grant MINTER_ROLE and ORACLE_ROLE, then revoke them cleanly", async function () {
      const { acm, admin, user } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      // 1. Grant MINTER_ROLE via canonical name
      const receipt1 = await grantRole(acmContract, admin, user.address, "MINTER_ROLE");
      expect(receipt1).to.not.be.null;

      let result = await checkRoles(acmContract, user.address);
      let minterStatus = result.roles.find((r) => r.name === "MINTER_ROLE");
      expect(minterStatus?.granted).to.be.true;

      // 2. Grant ORACLE_ROLE via alias 'oracle'
      const receipt2 = await grantRole(acmContract, admin, user.address, "oracle");
      expect(receipt2).to.not.be.null;

      result = await checkRoles(acmContract, user.address);
      let oracleStatus = result.roles.find((r) => r.name === "ORACLE_ROLE");
      expect(oracleStatus?.granted).to.be.true;

      // 3. Re-granting already granted role should be idempotent (return null)
      const noopGrant = await grantRole(acmContract, admin, user.address, "minter");
      expect(noopGrant).to.be.null;

      // 4. Revoke MINTER_ROLE via alias 'minter'
      const receipt3 = await revokeRole(acmContract, admin, user.address, "minter");
      expect(receipt3).to.not.be.null;

      result = await checkRoles(acmContract, user.address);
      minterStatus = result.roles.find((r) => r.name === "MINTER_ROLE");
      expect(minterStatus?.granted).to.be.false;

      // 5. Revoke ORACLE_ROLE via canonical name
      const receipt4 = await revokeRole(acmContract, admin, user.address, "ORACLE_ROLE");
      expect(receipt4).to.not.be.null;

      result = await checkRoles(acmContract, user.address);
      oracleStatus = result.roles.find((r) => r.name === "ORACLE_ROLE");
      expect(oracleStatus?.granted).to.be.false;

      // 6. Revoking already non-granted role should be idempotent (return null)
      const noopRevoke = await revokeRole(acmContract, admin, user.address, "ORACLE_ROLE");
      expect(noopRevoke).to.be.null;
    });

    it("Should throw error if unauthorized signer attempts grantRole or revokeRole", async function () {
      const { acm, admin, user, operator } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      // Unprivileged operator attempts to grant MINTER_ROLE to user
      let grantThrew = false;
      try {
        await grantRole(acmContract, operator, user.address, "MINTER_ROLE");
      } catch (err: any) {
        grantThrew = true;
        expect(err.message).to.include("does not have required admin role");
      }
      expect(grantThrew, "Expected grantRole to throw for unauthorized signer").to.be.true;

      // Admin grants first, then operator attempts to revoke
      await grantRole(acmContract, admin, user.address, "MINTER_ROLE");

      let revokeThrew = false;
      try {
        await revokeRole(acmContract, operator, user.address, "MINTER_ROLE");
      } catch (err: any) {
        revokeThrew = true;
        expect(err.message).to.include("does not have required admin role");
      }
      expect(revokeThrew, "Expected revokeRole to throw for unauthorized signer").to.be.true;
    });
  });

  describe("formatRoleTable", function () {
    it("Should format RoleCheckResult into human-readable ASCII table", async function () {
      const { acm, admin } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      const checkResult = await checkRoles(acmContract, admin.address);
      const table = formatRoleTable(checkResult);

      expect(table).to.include("HoloFi AccessControlManager Status");
      expect(table).to.include(admin.address);
      expect(table).to.include(await acm.getAddress());
      expect(table).to.include("KYB Approved   : NO [NOT APPROVED]");
      expect(table).to.include("DEFAULT_ADMIN_ROLE");
      expect(table).to.include("ADMIN_ROLE");
      expect(table).to.include("ORACLE_ROLE");
      expect(table).to.include("MINTER_ROLE");
      expect(table).to.include("KYB_MANAGER_ROLE");
      expect(table).to.include("PAUSER_ROLE");
      expect(table).to.include("[GRANTED]");
      expect(table).to.include("[NOT GRANTED]");
    });

    it("Should show YES [APPROVED] for KYB approved accounts", async function () {
      const { acm, admin, user } = await networkHelpers.loadFixture(deployAcmFixture);
      await acm.connect(admin).setKybStatus(user.address, true);

      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);
      const checkResult = await checkRoles(acmContract, user.address);
      const table = formatRoleTable(checkResult);

      expect(table).to.include("KYB Approved   : YES [APPROVED]");
    });
  });
});
