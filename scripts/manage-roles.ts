import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { network } from "hardhat";

export interface RoleDefinition {
  name: string;
  hash: string;
}

export const KNOWN_ROLES: RoleDefinition[] = [
  { name: "DEFAULT_ADMIN_ROLE", hash: ethers.ZeroHash },
  { name: "ADMIN_ROLE", hash: ethers.id("ADMIN_ROLE") },
  { name: "ORACLE_ROLE", hash: ethers.id("ORACLE_ROLE") },
  { name: "MINTER_ROLE", hash: ethers.id("MINTER_ROLE") },
  { name: "KYB_MANAGER_ROLE", hash: ethers.id("KYB_MANAGER_ROLE") },
  { name: "PAUSER_ROLE", hash: ethers.id("PAUSER_ROLE") },
  { name: "LOCKER_ROLE", hash: ethers.id("LOCKER_ROLE") },
];

export const ACM_ABI = [
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function getRoleAdmin(bytes32 role) external view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "function revokeRole(bytes32 role, address account) external",
  "function isKybApproved(address account) external view returns (bool)",
  "function setKybStatus(address account, bool status) external",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function ADMIN_ROLE() external view returns (bytes32)",
  "function ORACLE_ROLE() external view returns (bytes32)",
  "function KYB_MANAGER_ROLE() external view returns (bytes32)",
  "function PAUSER_ROLE() external view returns (bytes32)",
  "function MINTER_ROLE() external view returns (bytes32)",
  "function LOCKER_ROLE() external view returns (bytes32)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event KybStatusUpdated(address indexed account, bool status, address indexed operator)",
];

export interface RoleStatus {
  name: string;
  hash: string;
  granted: boolean;
}

export interface RoleCheckResult {
  targetAddress: string;
  acmAddress: string;
  roles: RoleStatus[];
  isKybApproved: boolean;
}

export interface ParsedCliArgs {
  action?: string;
  targetAddress?: string;
  roleName?: string;
  statusValue?: boolean;
  acmAddress?: string;
  networkName?: string;
  help?: boolean;
}

/**
 * Resolve a role name or alias to its bytes32 role hash.
 */
export function resolveRoleHash(roleInput: string): string {
  const normalized = roleInput.trim();

  // If already a valid 32-byte hex string
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return normalized.toLowerCase();
  }

  const key = normalized.toUpperCase().replace(/[\s-]+/g, "_");

  switch (key) {
    case "DEFAULT_ADMIN_ROLE":
    case "DEFAULT_ADMIN":
    case "DEFAULTADMIN":
    case "ROOT":
    case "ZERO":
      return ethers.ZeroHash;
    case "ADMIN_ROLE":
    case "ADMIN":
      return ethers.id("ADMIN_ROLE");
    case "ORACLE_ROLE":
    case "ORACLE":
    case "FEEDER":
    case "PRICE_FEEDER":
      return ethers.id("ORACLE_ROLE");
    case "MINTER_ROLE":
    case "MINTER":
      return ethers.id("MINTER_ROLE");
    case "KYB_MANAGER_ROLE":
    case "KYB_MANAGER":
    case "KYB":
      return ethers.id("KYB_MANAGER_ROLE");
    case "PAUSER_ROLE":
    case "PAUSER":
      return ethers.id("PAUSER_ROLE");
    case "LOCKER_ROLE":
    case "LOCKER":
      return ethers.id("LOCKER_ROLE");
    default:
      throw new Error(
        `Unknown role "${roleInput}". Supported roles: DEFAULT_ADMIN_ROLE, ADMIN_ROLE, ORACLE_ROLE, MINTER_ROLE, KYB_MANAGER_ROLE, PAUSER_ROLE, LOCKER_ROLE, or a 32-byte hex string.`
      );
  }
}

/**
 * Get human-readable role name from hash if known.
 */
export function getRoleNameFromHash(hash: string): string {
  const normalized = hash.toLowerCase();
  for (const role of KNOWN_ROLES) {
    if (role.hash.toLowerCase() === normalized) {
      return role.name;
    }
  }
  return hash;
}

/**
 * Parse a boolean status string with human-friendly aliases.
 */
export function parseBooleanStatus(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  switch (normalized) {
    case "true":
    case "1":
    case "approve":
    case "approved":
    case "pass":
    case "yes":
    case "enable":
      return true;
    case "false":
    case "0":
    case "revoke":
    case "revoked":
    case "reject":
    case "rejected":
    case "no":
    case "disable":
      return false;
    default:
      throw new Error(
        `Invalid status "${input}". Accepted values: true, false, 1, 0, approve, approved, reject, rejected, pass, revoke, revoked, yes, no, enable, disable.`
      );
  }
}

/**
 * Resolve AccessControlManager contract address with precedence:
 * 1. CLI argument
 * 2. Environment variable ACM_ADDRESS / ACCESS_CONTROL_MANAGER_ADDRESS
 * 3. Ignition deployment files
 */
export async function resolveAcmAddress(
  provider: ethers.Provider,
  cliAcmAddress?: string,
  projectRoot: string = process.cwd()
): Promise<string> {
  if (cliAcmAddress && ethers.isAddress(cliAcmAddress)) {
    return ethers.getAddress(cliAcmAddress);
  }

  if (process.env.ACM_ADDRESS && ethers.isAddress(process.env.ACM_ADDRESS)) {
    return ethers.getAddress(process.env.ACM_ADDRESS);
  }

  if (
    process.env.ACCESS_CONTROL_MANAGER_ADDRESS &&
    ethers.isAddress(process.env.ACCESS_CONTROL_MANAGER_ADDRESS)
  ) {
    return ethers.getAddress(process.env.ACCESS_CONTROL_MANAGER_ADDRESS);
  }

  // Check Ignition deployments
  try {
    const networkInfo = await provider.getNetwork();
    const chainId = networkInfo.chainId.toString();

    // 1. Check exact chain deployment file
    const chainDeploymentPath = path.resolve(
      projectRoot,
      `ignition/deployments/chain-${chainId}/deployed_addresses.json`
    );
    if (fs.existsSync(chainDeploymentPath)) {
      const data = JSON.parse(fs.readFileSync(chainDeploymentPath, "utf-8"));
      for (const [key, addr] of Object.entries(data)) {
        if (
          key.includes("AccessControlManager") &&
          typeof addr === "string" &&
          ethers.isAddress(addr)
        ) {
          return ethers.getAddress(addr);
        }
      }
    }

    // 2. Search all ignition deployments directories
    const deploymentsDir = path.resolve(projectRoot, "ignition/deployments");
    if (fs.existsSync(deploymentsDir)) {
      const entries = fs.readdirSync(deploymentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const file = path.join(deploymentsDir, entry.name, "deployed_addresses.json");
          if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, "utf-8"));
            for (const [key, addr] of Object.entries(data)) {
              if (
                key.includes("AccessControlManager") &&
                typeof addr === "string" &&
                ethers.isAddress(addr)
              ) {
                return ethers.getAddress(addr);
              }
            }
          }
        }
      }
    }

    // 3. Search root deployed_addresses.json
    const rootDeployed = path.resolve(projectRoot, "deployed_addresses.json");
    if (fs.existsSync(rootDeployed)) {
      const data = JSON.parse(fs.readFileSync(rootDeployed, "utf-8"));
      for (const [key, addr] of Object.entries(data)) {
        if (
          key.includes("AccessControlManager") &&
          typeof addr === "string" &&
          ethers.isAddress(addr)
        ) {
          return ethers.getAddress(addr);
        }
      }
    }
  } catch {
    // Continue to error throw
  }

  throw new Error(
    "Could not resolve AccessControlManager address. Please provide it as a CLI argument, set ACM_ADDRESS in your environment, or deploy the protocol via Ignition."
  );
}

/**
 * Returns a typed/typed-compatible contract instance for AccessControlManager.
 */
export function getAcmContract(
  address: string,
  runner: ethers.ContractRunner
): ethers.Contract {
  return new ethers.Contract(address, ACM_ABI, runner);
}

/**
 * Check all roles and KYB status for a target address.
 */
export async function checkRoles(
  acm: ethers.Contract,
  targetAddress: string
): Promise<RoleCheckResult> {
  const checksumTarget = ethers.getAddress(targetAddress);
  const acmAddress = await acm.getAddress();

  const roleChecks = await Promise.all(
    KNOWN_ROLES.map(async (role) => {
      const granted = (await acm.hasRole(role.hash, checksumTarget)) as boolean;
      return {
        name: role.name,
        hash: role.hash,
        granted,
      };
    })
  );

  const isKybApproved = (await acm.isKybApproved(checksumTarget)) as boolean;

  return {
    targetAddress: checksumTarget,
    acmAddress,
    roles: roleChecks,
    isKybApproved,
  };
}

/**
 * Format RoleCheckResult into an ASCII table string.
 */
export function formatRoleTable(result: RoleCheckResult): string {
  const border = "=".repeat(80);
  const divider = "-".repeat(80);
  const subDivider = "-".repeat(24) + "+" + "-".repeat(46) + "+" + "-".repeat(10);

  const kybStatusStr = result.isKybApproved ? "YES [APPROVED]" : "NO [NOT APPROVED]";

  const roleLines = result.roles.map((r) => {
    const paddedName = r.name.padEnd(24);
    const shortHash =
      r.hash === ethers.ZeroHash
        ? "0x0000000000000000000000000000000000000000..."
        : `${r.hash.slice(0, 42)}...`;
    const paddedHash = shortHash.padEnd(46);
    const status = r.granted ? "[GRANTED]" : "[NOT GRANTED]";
    return `${paddedName}| ${paddedHash}| ${status}`;
  });

  return [
    border,
    "                       HoloFi AccessControlManager Status                       ",
    border,
    `Target Address : ${result.targetAddress}`,
    `ACM Address    : ${result.acmAddress}`,
    `KYB Approved   : ${kybStatusStr}`,
    divider,
    "ROLE NAME               | ROLE HASH                                    | STATUS",
    subDivider,
    ...roleLines,
    border,
  ].join("\n");
}

/**
 * Grant a role to a target address.
 */
export async function grantRole(
  acm: ethers.Contract,
  signer: ethers.Signer,
  targetAddress: string,
  roleInput: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const checksumTarget = ethers.getAddress(targetAddress);
  const roleHash = resolveRoleHash(roleInput);
  const roleName = getRoleNameFromHash(roleHash);

  const isAlreadyGranted = (await acm.hasRole(roleHash, checksumTarget)) as boolean;
  if (isAlreadyGranted) {
    console.log(`[INFO] Target ${checksumTarget} already has role ${roleName}.`);
    return null;
  }

  const roleAdmin = (await acm.getRoleAdmin(roleHash)) as string;
  const signerAddress = await signer.getAddress();
  const hasAdmin = (await acm.hasRole(roleAdmin, signerAddress)) as boolean;

  if (!hasAdmin) {
    const adminName = getRoleNameFromHash(roleAdmin);
    throw new Error(
      `Signer ${signerAddress} does not have required admin role (${adminName}) to grant ${roleName}.`
    );
  }

  console.log(`Submitting grantRole(${roleName}, ${checksumTarget})...`);
  const connectedAcm = acm.connect(signer) as ethers.Contract;
  const tx = (await connectedAcm.grantRole(roleHash, checksumTarget)) as ethers.ContractTransactionResponse;
  console.log(`Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block: ${receipt?.blockNumber ?? "unknown"}`);
  console.log(`[SUCCESS] Role ${roleName} successfully granted to ${checksumTarget}.`);

  return receipt;
}

/**
 * Revoke a role from a target address.
 */
export async function revokeRole(
  acm: ethers.Contract,
  signer: ethers.Signer,
  targetAddress: string,
  roleInput: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const checksumTarget = ethers.getAddress(targetAddress);
  const roleHash = resolveRoleHash(roleInput);
  const roleName = getRoleNameFromHash(roleHash);

  const isGranted = (await acm.hasRole(roleHash, checksumTarget)) as boolean;
  if (!isGranted) {
    console.log(`[INFO] Target ${checksumTarget} does not currently have role ${roleName}.`);
    return null;
  }

  const roleAdmin = (await acm.getRoleAdmin(roleHash)) as string;
  const signerAddress = await signer.getAddress();
  const hasAdmin = (await acm.hasRole(roleAdmin, signerAddress)) as boolean;

  if (!hasAdmin) {
    const adminName = getRoleNameFromHash(roleAdmin);
    throw new Error(
      `Signer ${signerAddress} does not have required admin role (${adminName}) to revoke ${roleName}.`
    );
  }

  console.log(`Submitting revokeRole(${roleName}, ${checksumTarget})...`);
  const connectedAcm = acm.connect(signer) as ethers.Contract;
  const tx = (await connectedAcm.revokeRole(roleHash, checksumTarget)) as ethers.ContractTransactionResponse;
  console.log(`Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block: ${receipt?.blockNumber ?? "unknown"}`);
  console.log(`[SUCCESS] Role ${roleName} successfully revoked from ${checksumTarget}.`);

  return receipt;
}

/**
 * Update KYC/KYB compliance status for a target address.
 */
export async function setKybStatus(
  acm: ethers.Contract,
  signer: ethers.Signer,
  targetAddress: string,
  status: boolean
): Promise<ethers.ContractTransactionReceipt | null> {
  const checksumTarget = ethers.getAddress(targetAddress);
  const currentStatus = (await acm.isKybApproved(checksumTarget)) as boolean;
  if (currentStatus === status) {
    console.log(
      `[INFO] Target ${checksumTarget} already has KYB status set to ${status ? "APPROVED (true)" : "REVOKED (false)"}.`
    );
    return null;
  }

  const kybManagerRole = ethers.id("KYB_MANAGER_ROLE");
  const adminRole = ethers.id("ADMIN_ROLE");
  const signerAddress = await signer.getAddress();

  const hasKybManager = (await acm.hasRole(kybManagerRole, signerAddress)) as boolean;
  const hasAdmin = (await acm.hasRole(adminRole, signerAddress)) as boolean;

  if (!hasKybManager && !hasAdmin) {
    throw new Error(
      `Signer ${signerAddress} does not have required KYB_MANAGER_ROLE or ADMIN_ROLE to update KYB status.`
    );
  }

  console.log(`Submitting setKybStatus(${checksumTarget}, ${status})...`);
  const connectedAcm = acm.connect(signer) as ethers.Contract;
  const tx = (await connectedAcm.setKybStatus(checksumTarget, status)) as ethers.ContractTransactionResponse;
  console.log(`Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block: ${receipt?.blockNumber ?? "unknown"}`);
  console.log(
    `[SUCCESS] KYB status for ${checksumTarget} successfully updated to ${status ? "APPROVED (true)" : "REVOKED (false)"}.`
  );

  return receipt;
}

/**
 * Parse CLI arguments from process.argv.
 */
export function parseCliArgs(argv: string[] = process.argv): ParsedCliArgs {
  const result: ParsedCliArgs = {};

  const doubleDashIdx = argv.indexOf("--");
  let tokens: string[] = [];

  if (doubleDashIdx !== -1) {
    tokens = argv.slice(doubleDashIdx + 1);
  } else {
    for (let i = 2; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--help" || arg === "-h" || arg === "help") {
        result.help = true;
        continue;
      }
      if ((arg === "--network" || arg === "-n") && i + 1 < argv.length) {
        result.networkName = argv[++i];
        continue;
      }
      if (arg.startsWith("--network=")) {
        result.networkName = arg.split("=")[1];
        continue;
      }
      if (arg.startsWith("-n=")) {
        result.networkName = arg.split("=")[1];
        continue;
      }
      if (arg === "--acm" && i + 1 < argv.length) {
        result.acmAddress = argv[++i];
        continue;
      }
      if (arg.startsWith("--acm=")) {
        result.acmAddress = arg.split("=")[1];
        continue;
      }
      if (arg === "run" || arg.endsWith(".ts") || arg.endsWith(".js") || arg.endsWith("tsx")) {
        continue;
      }
      if (arg.startsWith("-")) {
        continue;
      }
      tokens.push(arg);
    }
  }

  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--help" || token === "-h" || token === "help") {
      result.help = true;
    } else if ((token === "--network" || token === "-n") && i + 1 < tokens.length) {
      result.networkName = tokens[++i];
    } else if (token.startsWith("--network=")) {
      result.networkName = token.split("=")[1];
    } else if (token.startsWith("-n=")) {
      result.networkName = token.split("=")[1];
    } else if (token === "--acm" && i + 1 < tokens.length) {
      result.acmAddress = tokens[++i];
    } else if (token.startsWith("--acm=")) {
      result.acmAddress = token.split("=")[1];
    } else if (!token.startsWith("-")) {
      positional.push(token);
    }
  }

  if (positional.length > 0) {
    result.action = positional[0].toLowerCase();
  }
  if (positional.length > 1) {
    result.targetAddress = positional[1];
  }

  if (
    result.action === "check" ||
    result.action === "list" ||
    result.action === "view" ||
    result.action === "status"
  ) {
    if (positional.length > 2) {
      if (!result.acmAddress && ethers.isAddress(positional[2])) {
        result.acmAddress = positional[2];
      } else {
        result.roleName = positional[2];
      }
    }
  } else if (
    result.action === "grant" ||
    result.action === "add" ||
    result.action === "revoke" ||
    result.action === "remove"
  ) {
    if (positional.length > 2) {
      result.roleName = positional[2];
    }
    if (positional.length > 3 && !result.acmAddress && ethers.isAddress(positional[3])) {
      result.acmAddress = positional[3];
    }
  } else if (
    result.action === "kyb" ||
    result.action === "kyc" ||
    result.action === "set-kyb" ||
    result.action === "set-kyc" ||
    result.action === "setkyb" ||
    result.action === "setkyc"
  ) {
    if (positional.length > 2) {
      result.statusValue = parseBooleanStatus(positional[2]);
    }
    if (positional.length > 3 && !result.acmAddress && ethers.isAddress(positional[3])) {
      result.acmAddress = positional[3];
    }
  }

  // Fallback to environment variables if not provided via CLI
  if (!result.action && process.env.ACTION) {
    result.action = process.env.ACTION.trim().toLowerCase();
  }
  if (!result.targetAddress) {
    const envTarget = process.env.ACCOUNT || process.env.TARGET || process.env.WALLET || process.env.TARGET_ADDRESS;
    if (envTarget) {
      result.targetAddress = envTarget.trim();
    }
  }
  if (!result.roleName) {
    const envRole = process.env.ROLE || process.env.ROLE_NAME;
    if (envRole) {
      result.roleName = envRole.trim();
    }
  }
  if (result.statusValue === undefined) {
    const envStatus = process.env.STATUS || process.env.KYB_STATUS || process.env.KYC_STATUS;
    if (envStatus !== undefined && envStatus !== "") {
      result.statusValue = parseBooleanStatus(envStatus);
    }
  }
  if (!result.acmAddress) {
    const envAcm = process.env.ACM_ADDRESS || process.env.ACCESS_CONTROL_MANAGER_ADDRESS;
    if (envAcm) {
      result.acmAddress = envAcm.trim();
    }
  }
  if (!result.networkName && process.env.HARDHAT_NETWORK) {
    result.networkName = process.env.HARDHAT_NETWORK.trim();
  }

  return result;
}

export function printHelp(): void {
  console.log(`
HoloFi Protocol - Role & KYC/KYB Permissions Management CLI
============================================================

Usage:
  npm run roles -- <action> <target_address> [role_name | status] [acm_address] [--network <network>]
  # or
  npx tsx scripts/manage-roles.ts <action> <target_address> [role_name | status] [acm_address] [--network <network>]
  # or with Hardhat run:
  ACTION=<action> ACCOUNT=<target_address> [ROLE=<role_name>] [STATUS=<status>] npx hardhat run scripts/manage-roles.ts --network <network>

Actions:
  check | list | view     View all role assignments and KYB status for target address
  grant | add             Grant a role to target address
  revoke | remove         Revoke a role from target address
  kyb | kyc | set-kyb     Set KYC/KYB compliance status for target address (true/false/approve/reject)

Supported Roles & Aliases (case-insensitive):
  ADMIN_ROLE              admin, ADMIN
  ORACLE_ROLE             oracle, feeder, price_feeder
  MINTER_ROLE             minter, MINTER
  KYB_MANAGER_ROLE        kyb, kyb_manager
  PAUSER_ROLE             pauser, PAUSER
  DEFAULT_ADMIN_ROLE      default_admin, root, zero, 0x0000...
  <bytes32>               Direct hex role hash (e.g. 0xdf8b4c520...)

Status Values & Aliases:
  Enable / Approve:       true, 1, approve, approved, pass, yes, enable
  Disable / Reject:       false, 0, revoke, revoked, reject, rejected, no, disable

Examples:
  npm run roles check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  npm run roles grant 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 MINTER_ROLE
  npm run roles grant 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 oracle
  npm run roles revoke 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 minter
  npm run roles kyb 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 approve
  npm run roles kyc 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 reject
  npm run roles -- check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --network baseSepolia
  npx tsx scripts/manage-roles.ts check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --network baseSepolia
`);
}

/**
 * Main CLI execution entrypoint.
 */
export async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help || !args.action) {
    printHelp();
    return;
  }

  const targetNetwork = args.networkName || process.env.HARDHAT_NETWORK || "localhost";
  let connection;
  try {
    connection = await network.connect({ network: targetNetwork });
  } catch (err) {
    throw new Error(
      `Failed to connect to network "${targetNetwork}": ${err instanceof Error ? err.message : err}. ` +
      `If targeting localhost, ensure a local RPC node is running (e.g. npx hardhat node).`
    );
  }

  const { ethers: hhEthers } = connection;
  const signers = await hhEthers.getSigners();
  const signer = signers.length > 0 ? signers[0] : null;
  const provider = signer ? signer.provider : hhEthers.provider;

  if (!provider) {
    throw new Error(`Unable to establish provider connection to network "${targetNetwork}".`);
  }

  if (!args.targetAddress || !ethers.isAddress(args.targetAddress)) {
    console.error(`\n[ERROR] Invalid or missing target address: "${args.targetAddress}"`);
    printHelp();
    process.exit(1);
  }

  const acmAddress = await resolveAcmAddress(provider, args.acmAddress);

  // Validate contract bytecode existence
  const code = await provider.getCode(acmAddress);
  if (code === "0x" || code === "0x0") {
    throw new Error(
      `No contract bytecode deployed at AccessControlManager address ${acmAddress} on network "${targetNetwork}".\n` +
      `Please ensure that:\n` +
      `  1. Your local node is running (e.g. npx hardhat node)\n` +
      `  2. Contracts are deployed on "${targetNetwork}" (e.g. npx hardhat ignition deploy ignition/modules/DeployHoloFiFullProtocol.ts --network ${targetNetwork})\n` +
      `  3. You are pointing to the correct network (--network <network>) or address (--acm <address>)`
    );
  }

  const acm = getAcmContract(acmAddress, signer || provider);

  switch (args.action) {
    case "check":
    case "list":
    case "view":
    case "status": {
      const result = await checkRoles(acm, args.targetAddress);
      console.log("\n" + formatRoleTable(result) + "\n");
      break;
    }
    case "grant":
    case "add": {
      if (!args.roleName) {
        console.error("\n[ERROR] Role name or hash is required for grant action.");
        printHelp();
        process.exit(1);
      }
      if (!signer) {
        console.error("\n[ERROR] Signer is required to execute grant transaction on network \"" + targetNetwork + "\".");
        process.exit(1);
      }
      await grantRole(acm, signer, args.targetAddress, args.roleName);
      const result = await checkRoles(acm, args.targetAddress);
      console.log("\nUpdated Role Status:\n" + formatRoleTable(result) + "\n");
      break;
    }
    case "revoke":
    case "remove": {
      if (!args.roleName) {
        console.error("\n[ERROR] Role name or hash is required for revoke action.");
        printHelp();
        process.exit(1);
      }
      if (!signer) {
        console.error("\n[ERROR] Signer is required to execute revoke transaction on network \"" + targetNetwork + "\".");
        process.exit(1);
      }
      await revokeRole(acm, signer, args.targetAddress, args.roleName);
      const result = await checkRoles(acm, args.targetAddress);
      console.log("\nUpdated Role Status:\n" + formatRoleTable(result) + "\n");
      break;
    }
    case "kyb":
    case "kyc":
    case "set-kyb":
    case "set-kyc":
    case "setkyb":
    case "setkyc": {
      if (args.statusValue === undefined) {
        console.error("\n[ERROR] Status value (e.g. true/false/approve/reject) is required for KYC/KYB action.");
        printHelp();
        process.exit(1);
      }
      if (!signer) {
        console.error("\n[ERROR] Signer is required to execute KYC/KYB update transaction on network \"" + targetNetwork + "\".");
        process.exit(1);
      }
      await setKybStatus(acm, signer, args.targetAddress, args.statusValue);
      const result = await checkRoles(acm, args.targetAddress);
      console.log("\nUpdated Role Status:\n" + formatRoleTable(result) + "\n");
      break;
    }
    default: {
      console.error(`\n[ERROR] Unknown action "${args.action}".`);
      printHelp();
      process.exit(1);
    }
  }
}

// Auto-run if executed directly as CLI script
const isDirectScriptExecution =
  process.argv.some(
    (arg) => arg.includes("manage-roles.ts") || arg.includes("manage-roles.js")
  ) && !process.env.npm_lifecycle_event?.includes("test");

if (isDirectScriptExecution) {
  main().catch((error) => {
    console.error("\n[FATAL ERROR]:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
