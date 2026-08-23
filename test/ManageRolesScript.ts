import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";
import {
  parseCliArgs,
  parseBooleanStatus,
  resolveRoleHash,
  getRoleNameFromHash,
  resolveAcmAddress,
  getAcmContract,
  checkRoles,
  formatRoleTable,
  grantRole,
  revokeRole,
  setKybStatus,
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

    it("Should parse --network and -n flags", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed1 = parseCliArgs(["node", "manage-roles.ts", "check", target, "--network", "baseSepolia"]);
      expect(parsed1.action).to.equal("check");
      expect(parsed1.targetAddress).to.equal(target);
      expect(parsed1.networkName).to.equal("baseSepolia");

      const parsed2 = parseCliArgs(["node", "manage-roles.ts", "check", target, "-n", "sepolia"]);
      expect(parsed2.networkName).to.equal("sepolia");

      const parsed3 = parseCliArgs(["node", "manage-roles.ts", "--network=mainnet", "check", target]);
      expect(parsed3.networkName).to.equal("mainnet");

      const parsed4 = parseCliArgs(["node", "manage-roles.ts", "-n=polygon", "check", target]);
      expect(parsed4.networkName).to.equal("polygon");
    });

    it("Should parse --help flag", function () {
      const parsed = parseCliArgs(["node", "manage-roles.ts", "--help"]);
      expect(parsed.help).to.be.true;
    });

    it("Should parse 'kyb' action with boolean status alias", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "kyb", target, "approve"]);
      expect(parsed.action).to.equal("kyb");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.statusValue).to.be.true;
    });

    it("Should parse 'kyc' action with boolean status alias", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "kyc", target, "reject"]);
      expect(parsed.action).to.equal("kyc");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.statusValue).to.be.false;
    });

    it("Should parse 'set-kyb' action with custom ACM address", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const customAcm = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "set-kyb", target, "true", customAcm]);
      expect(parsed.action).to.equal("set-kyb");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.statusValue).to.be.true;
      expect(parsed.acmAddress).to.equal(customAcm);
    });

    it("Should parse status value from environment variable", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      process.env.ACTION = "kyb";
      process.env.ACCOUNT = target;
      process.env.STATUS = "enable";
      try {
        const parsed = parseCliArgs(["node", "manage-roles.ts"]);
        expect(parsed.action).to.equal("kyb");
        expect(parsed.targetAddress).to.equal(target);
        expect(parsed.statusValue).to.be.true;
      } finally {
        delete process.env.ACTION;
        delete process.env.ACCOUNT;
        delete process.env.STATUS;
      }
    });

    it("Should parse --network flag", function () {
      const target = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "manage-roles.ts", "check", target, "--network", "sepolia"]);
      expect(parsed.action).to.equal("check");
      expect(parsed.targetAddress).to.equal(target);
      expect(parsed.networkName).to.equal("sepolia");
    });
  });

  describe("parseBooleanStatus", function () {
    it("Should correctly parse all truthy boolean aliases", function () {
      const truthyAliases = [
        "true",
        "TRUE",
        "True",
        " 1 ",
        "approve",
        "APPROVE",
        "Approve",
        "approved",
        "APPROVED",
        "pass",
        "PASS",
        "yes",
        "YES",
        "enable",
        "ENABLE",
      ];
      for (const alias of truthyAliases) {
        expect(parseBooleanStatus(alias), `Failed for alias: ${alias}`).to.be.true;
      }
    });

    it("Should correctly parse all falsy boolean aliases", function () {
      const falsyAliases = [
        "false",
        "FALSE",
        "False",
        " 0 ",
        "revoke",
        "REVOKE",
        "revoked",
        "REVOKED",
        "reject",
        "REJECT",
        "rejected",
        "REJECTED",
        "no",
        "NO",
        "disable",
        "DISABLE",
      ];
      for (const alias of falsyAliases) {
        expect(parseBooleanStatus(alias), `Failed for alias: ${alias}`).to.be.false;
      }
    });

    it("Should throw for invalid status strings", function () {
      const invalidInputs = ["invalid", "maybe", "2", "-1", "active", "pending", ""];
      for (const input of invalidInputs) {
        expect(
          () => parseBooleanStatus(input),
          `Expected parseBooleanStatus("${input}") to throw`
        ).to.throw("Invalid status");
      }
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
      expect(resolveRoleHash("LOCKER_ROLE")).to.equal(ethersLib.id("LOCKER_ROLE"));
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
      expect(resolveRoleHash("locker")).to.equal(ethersLib.id("LOCKER_ROLE"));
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
      expect(getRoleNameFromHash(ethersLib.id("LOCKER_ROLE"))).to.equal("LOCKER_ROLE");

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

    it("Should resolve from networkName mapping (e.g. baseSepolia) even if provider fails", async function () {
      const failingProvider = {
        getNetwork: async () => {
          throw new Error("RPC unreachable");
        },
      } as any;

      const resolved = await resolveAcmAddress(failingProvider, undefined, process.cwd(), "baseSepolia");
      expect(resolved).to.equal("0xde63B0aabF749837B9BA2537A1B6385d87777691");
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

  describe("setKybStatus helper", function () {
    it("Should allow admin to approve and revoke KYB status with idempotency", async function () {
      const { acm, admin, user } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      // 1. Initial status is false
      let check = await checkRoles(acmContract, user.address);
      expect(check.isKybApproved).to.be.false;

      // 2. Admin sets KYB status to true (approve)
      const receipt1 = await setKybStatus(acmContract, admin, user.address, true);
      expect(receipt1).to.not.be.null;

      check = await checkRoles(acmContract, user.address);
      expect(check.isKybApproved).to.be.true;

      // 3. Setting status to true again is idempotent (returns null)
      const noop = await setKybStatus(acmContract, admin, user.address, true);
      expect(noop).to.be.null;

      // 4. Admin sets KYB status back to false (revoke)
      const receipt2 = await setKybStatus(acmContract, admin, user.address, false);
      expect(receipt2).to.not.be.null;

      check = await checkRoles(acmContract, user.address);
      expect(check.isKybApproved).to.be.false;

      // 5. Setting status to false again is idempotent (returns null)
      const noop2 = await setKybStatus(acmContract, admin, user.address, false);
      expect(noop2).to.be.null;
    });

    it("Should allow account with KYB_MANAGER_ROLE to update KYB status", async function () {
      const { acm, admin, operator, user } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      // Grant KYB_MANAGER_ROLE to operator
      await grantRole(acmContract, admin, operator.address, "KYB_MANAGER_ROLE");

      // Operator updates KYB status for user to true
      const receipt = await setKybStatus(acmContract, operator, user.address, true);
      expect(receipt).to.not.be.null;

      const check = await checkRoles(acmContract, user.address);
      expect(check.isKybApproved).to.be.true;
    });

    it("Should throw error if unauthorized signer attempts setKybStatus", async function () {
      const { acm, user, operator } = await networkHelpers.loadFixture(deployAcmFixture);
      const acmContract = getAcmContract(await acm.getAddress(), ethers.provider);

      let threw = false;
      try {
        await setKybStatus(acmContract, operator, user.address, true);
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include("does not have required KYB_MANAGER_ROLE or ADMIN_ROLE");
      }
      expect(threw, "Expected setKybStatus to throw for unauthorized caller").to.be.true;
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
