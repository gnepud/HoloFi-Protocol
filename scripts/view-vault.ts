import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { network } from "hardhat";

export const LOAN_CORE_ABI = [
  "function getVault(uint256 vaultId) external view returns (tuple(uint256 vaultId, address owner, address lendingPool, uint256[] tokenIds, uint256 principalDebt, uint256 accumulatedInterest, uint256 lastInterestUpdateTime, uint8 status))",
  "function getVaultFMV(uint256 vaultId) external view returns (uint256)",
  "function getMaxBorrowCapacity(uint256 vaultId, uint256 vaultFmv) external view returns (uint256)",
  "function getPendingInterest(uint256 vaultId) external view returns (uint256)",
  "function getTotalDebt(uint256 vaultId) external view returns (uint256)",
  "function getHealthFactor(uint256 vaultId, uint256 vaultFmv) external view returns (uint256)",
  "function vaultCard() external view returns (address)",
  "function priceFeed() external view returns (address)",
  "function acm() external view returns (address)",
  "function poolFactory() external view returns (address)",
];

export const LENDING_POOL_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function asset() external view returns (address)",
  "function maxLtvBps() external view returns (uint256)",
  "function liquidationThresholdBps() external view returns (uint256)",
  "function liquidationPenaltyBps() external view returns (uint256)",
  "function borrowRateBpsPerYear() external view returns (uint256)",
  "function eligibilityPolicy() external view returns (address)",
];

export const POLICY_ABI = [
  "function requiredGrader() external view returns (string)",
  "function minGrade() external view returns (uint256)",
  "function maxGrade() external view returns (uint256)",
  "function isCardTypeEligible(bytes32 cardTypeId) external view returns (bool)",
];

export const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

export const VAULT_CARD_ABI = [
  "function getCard(uint256 tokenId) external view returns (tuple(uint256 tokenId, bytes32 cardTypeId, bytes32 attestationHash, uint256 mintTimestamp, bool isLocked))",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
];

export const PRICE_FEED_ABI = [
  "function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated)",
  "function isSupportedCardType(bytes32 cardTypeId) external view returns (bool)",
];

export const ACM_ABI = [
  "function isKybApproved(address account) external view returns (bool)",
];

export interface ParsedCliArgs {
  vaultId?: bigint;
  loanCoreAddress?: string;
  networkName?: string;
  help?: boolean;
}

export interface CollateralCardSummary {
  tokenId: bigint;
  cardTypeId: string;
  attestationHash: string;
  mintTimestamp: bigint;
  mintDate: string;
  isLocked: boolean;
  tokenURI: string;
  priceRaw?: bigint;
  priceFormatted?: string;
}

export interface LendingPoolDetails {
  poolAddress: string;
  poolName: string;
  poolSymbol: string;
  assetAddress: string;
  assetName: string;
  assetSymbol: string;
  assetDecimals: number;
  maxLtvBps: bigint;
  maxLtvPercent: string;
  liquidationThresholdBps: bigint;
  liquidationThresholdPercent: string;
  liquidationPenaltyBps: bigint;
  liquidationPenaltyPercent: string;
  borrowRateBpsPerYear: bigint;
  borrowRatePercent: string;
  eligibilityPolicyAddress: string;
  eligibilityPolicyLabel: string;
}

export interface VaultDetails {
  vaultId: bigint;
  loanCoreAddress: string;
  status: number;
  statusLabel: string;
  owner: string;
  isOwnerKybApproved: boolean;
  lastInterestUpdateTime: bigint;
  lastInterestUpdateDate: string;
  lendingPoolAddress: string;
  lendingPoolDetails?: LendingPoolDetails;
  tokenIds: bigint[];
  collateralCards: CollateralCardSummary[];
  totalCollateralFmvRaw: bigint;
  totalCollateralFmvFormatted: string;
  maxBorrowCapacityRaw: bigint;
  maxBorrowCapacityFormatted: string;
  principalDebtRaw: bigint;
  principalDebtFormatted: string;
  accumulatedInterestRaw: bigint;
  accumulatedInterestFormatted: string;
  pendingInterestRaw: bigint;
  pendingInterestFormatted: string;
  totalDebtRaw: bigint;
  totalDebtFormatted: string;
  remainingBorrowCapacityRaw: bigint;
  remainingBorrowCapacityFormatted: string;
  currentLtvPercent: string;
  healthFactorRaw: bigint;
  healthFactorFormatted: string;
  healthStatus: "HEALTHY" | "LIQUIDATABLE" | "NO_DEBT";
}

/**
 * Parse CLI arguments for view-vault command.
 */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {};
  const args = argv.slice(2);

  const doubleDashIdx = args.indexOf("--");
  const filteredArgs = doubleDashIdx !== -1 ? args.slice(doubleDashIdx + 1) : args;

  const positional: string[] = [];

  for (let i = 0; i < filteredArgs.length; i++) {
    const arg = filteredArgs[i];

    if (arg === "--help" || arg === "-h" || arg === "help") {
      result.help = true;
      return result;
    }

    if (
      arg === "--loan-core" ||
      arg === "--loancore" ||
      arg === "-l" ||
      arg === "--contract" ||
      arg === "-c"
    ) {
      if (i + 1 < filteredArgs.length) {
        result.loanCoreAddress = filteredArgs[++i];
      }
      continue;
    }

    if (arg.startsWith("--loan-core=")) {
      result.loanCoreAddress = arg.split("=")[1];
      continue;
    }
    if (arg.startsWith("--loancore=")) {
      result.loanCoreAddress = arg.split("=")[1];
      continue;
    }
    if (arg.startsWith("--contract=")) {
      result.loanCoreAddress = arg.split("=")[1];
      continue;
    }

    if (arg === "--network" || arg === "-n") {
      if (i + 1 < filteredArgs.length) {
        result.networkName = filteredArgs[++i];
      }
      continue;
    }

    if (arg.startsWith("--network=")) {
      result.networkName = arg.split("=")[1];
      continue;
    }

    if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  // Parse positional arguments
  for (const token of positional) {
    if (/^\d+$/.test(token) && result.vaultId === undefined) {
      result.vaultId = BigInt(token);
    } else if (ethers.isAddress(token) && !result.loanCoreAddress) {
      result.loanCoreAddress = token;
    }
  }

  // Fallbacks to environment variables
  if (result.vaultId === undefined) {
    const envVaultId = process.env.VAULT_ID || process.env.ID;
    if (envVaultId && /^\d+$/.test(envVaultId.trim())) {
      result.vaultId = BigInt(envVaultId.trim());
    }
  }

  if (!result.loanCoreAddress) {
    const envLoanCore =
      process.env.LOAN_CORE_ADDRESS ||
      process.env.VAULT_LOAN_CORE_ADDRESS ||
      process.env.CONTRACT_ADDRESS;
    if (envLoanCore && ethers.isAddress(envLoanCore.trim())) {
      result.loanCoreAddress = envLoanCore.trim();
    }
  }

  if (!result.networkName && process.env.HARDHAT_NETWORK) {
    result.networkName = process.env.HARDHAT_NETWORK.trim();
  }

  return result;
}

/**
 * Resolve HoloFiVaultLoanCore contract address with precedence:
 * 1. CLI argument
 * 2. Environment variable LOAN_CORE_ADDRESS / VAULT_LOAN_CORE_ADDRESS / CONTRACT_ADDRESS
 * 3. Ignition deployment files
 */
export async function resolveLoanCoreAddress(
  provider: ethers.Provider,
  projectRoot: string = process.cwd(),
  cliAddress?: string
): Promise<string> {
  if (cliAddress && ethers.isAddress(cliAddress)) {
    return ethers.getAddress(cliAddress);
  }

  if (
    process.env.LOAN_CORE_ADDRESS &&
    ethers.isAddress(process.env.LOAN_CORE_ADDRESS)
  ) {
    return ethers.getAddress(process.env.LOAN_CORE_ADDRESS);
  }

  if (
    process.env.VAULT_LOAN_CORE_ADDRESS &&
    ethers.isAddress(process.env.VAULT_LOAN_CORE_ADDRESS)
  ) {
    return ethers.getAddress(process.env.VAULT_LOAN_CORE_ADDRESS);
  }

  if (
    process.env.CONTRACT_ADDRESS &&
    ethers.isAddress(process.env.CONTRACT_ADDRESS)
  ) {
    return ethers.getAddress(process.env.CONTRACT_ADDRESS);
  }

  // Check Ignition deployments
  try {
    const networkInfo = await provider.getNetwork();
    const chainId = networkInfo.chainId.toString();

    // 1. Search chain-specific deployed_addresses.json
    const chainDeployedPath = path.resolve(
      projectRoot,
      "ignition",
      "deployments",
      `chain-${chainId}`,
      "deployed_addresses.json"
    );

    if (fs.existsSync(chainDeployedPath)) {
      const data = JSON.parse(fs.readFileSync(chainDeployedPath, "utf-8"));
      for (const [key, addr] of Object.entries(data)) {
        if (
          (key === "DeployHoloFiProtocol#HoloFiVaultLoanCore" ||
            key === "HoloFiVaultLoanCore" ||
            key.includes("HoloFiVaultLoanCore") ||
            key.includes("LoanCore")) &&
          typeof addr === "string" &&
          ethers.isAddress(addr)
        ) {
          return ethers.getAddress(addr);
        }
      }
    }

    // 2. Search any ignition deployment directory
    const ignitionDeploymentsDir = path.resolve(projectRoot, "ignition", "deployments");
    if (fs.existsSync(ignitionDeploymentsDir)) {
      const subdirs = fs.readdirSync(ignitionDeploymentsDir);
      for (const subdir of subdirs) {
        const deployedFile = path.join(ignitionDeploymentsDir, subdir, "deployed_addresses.json");
        if (fs.existsSync(deployedFile)) {
          const data = JSON.parse(fs.readFileSync(deployedFile, "utf-8"));
          for (const [key, addr] of Object.entries(data)) {
            if (
              (key === "DeployHoloFiProtocol#HoloFiVaultLoanCore" ||
                key === "HoloFiVaultLoanCore" ||
                key.includes("HoloFiVaultLoanCore") ||
                key.includes("LoanCore")) &&
              typeof addr === "string" &&
              ethers.isAddress(addr)
            ) {
              return ethers.getAddress(addr);
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
          (key === "DeployHoloFiProtocol#HoloFiVaultLoanCore" ||
            key === "HoloFiVaultLoanCore" ||
            key.includes("HoloFiVaultLoanCore") ||
            key.includes("LoanCore")) &&
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
    "Could not resolve HoloFiVaultLoanCore contract address. Please provide it as a CLI argument, set LOAN_CORE_ADDRESS in your environment, or deploy the protocol via Ignition."
  );
}

/**
 * Fetch full details of a given vault by querying LoanCore, LendingPool, VaultCard, PriceFeed, and ACM.
 */
export async function fetchVaultDetails(
  provider: ethers.Provider,
  loanCoreContract: ethers.Contract,
  vaultId: bigint
): Promise<VaultDetails> {
  const loanCoreAddress = await loanCoreContract.getAddress();

  // 1. Fetch vault struct from LoanCore
  const vaultStruct = await loanCoreContract.getVault(vaultId);
  const owner: string = vaultStruct[1];
  const lendingPoolAddress: string = vaultStruct[2];
  const tokenIdsRaw: bigint[] = Array.from(vaultStruct[3]);
  const principalDebtRaw: bigint = BigInt(vaultStruct[4]);
  const accumulatedInterestRaw: bigint = BigInt(vaultStruct[5]);
  const lastInterestUpdateTime: bigint = BigInt(vaultStruct[6]);
  const statusNum: number = Number(vaultStruct[7]);

  if (owner === ethers.ZeroAddress && statusNum === 0 && lendingPoolAddress === ethers.ZeroAddress) {
    throw new Error(`Vault #${vaultId.toString()} does not exist or is uninitialized.`);
  }

  let statusLabel: string;
  switch (statusNum) {
    case 0:
      statusLabel = "ACTIVE [Borrowing & Collateral Active]";
      break;
    case 1:
      statusLabel = "LIQUIDATING [Auction in Progress]";
      break;
    case 2:
      statusLabel = "CLOSED [Settled & Released]";
      break;
    default:
      statusLabel = `UNKNOWN (${statusNum})`;
  }

  const lastInterestUpdateDate =
    lastInterestUpdateTime > 0n
      ? new Date(Number(lastInterestUpdateTime) * 1000).toISOString()
      : "Never";

  // 2. Fetch ACM KYB approval
  let isOwnerKybApproved = false;
  try {
    const acmAddress = await loanCoreContract.acm();
    if (acmAddress && acmAddress !== ethers.ZeroAddress) {
      const acmContract = new ethers.Contract(acmAddress, ACM_ABI, provider);
      isOwnerKybApproved = await acmContract.isKybApproved(owner);
    }
  } catch {
    // Non-critical if ACM query fails
  }

  // 3. Fetch Lending Pool details
  let lendingPoolDetails: LendingPoolDetails | undefined;
  let assetDecimals = 6;
  let assetSymbol = "EURC";
  let maxLtvBps = 5000n;
  let liquidationThresholdBps = 7000n;

  if (lendingPoolAddress && lendingPoolAddress !== ethers.ZeroAddress) {
    try {
      const poolContract = new ethers.Contract(lendingPoolAddress, LENDING_POOL_ABI, provider);
      const [
        poolName,
        poolSymbol,
        assetAddress,
        poolMaxLtv,
        poolLiqThreshold,
        poolLiqPenalty,
        poolBorrowRate,
        policyAddress,
      ] = await Promise.all([
        poolContract.name().catch(() => "Unknown Pool"),
        poolContract.symbol().catch(() => "pPOOL"),
        poolContract.asset().catch(() => ethers.ZeroAddress),
        poolContract.maxLtvBps().catch(() => 5000n),
        poolContract.liquidationThresholdBps().catch(() => 7000n),
        poolContract.liquidationPenaltyBps().catch(() => 1000n),
        poolContract.borrowRateBpsPerYear().catch(() => 500n),
        poolContract.eligibilityPolicy().catch(() => ethers.ZeroAddress),
      ]);

      maxLtvBps = BigInt(poolMaxLtv);
      liquidationThresholdBps = BigInt(poolLiqThreshold);

      let assetName = "Euro Coin";
      if (assetAddress && assetAddress !== ethers.ZeroAddress) {
        try {
          const erc20Contract = new ethers.Contract(assetAddress, ERC20_ABI, provider);
          const [aName, aSym, aDec] = await Promise.all([
            erc20Contract.name().catch(() => "Euro Coin"),
            erc20Contract.symbol().catch(() => "EURC"),
            erc20Contract.decimals().catch(() => 6),
          ]);
          assetName = aName;
          assetSymbol = aSym;
          assetDecimals = Number(aDec);
        } catch {
          // Defaults applied
        }
      }

      let policyLabel = "None [Open / All Cards Permitted]";
      if (policyAddress && policyAddress !== ethers.ZeroAddress) {
        try {
          const policyContract = new ethers.Contract(policyAddress, POLICY_ABI, provider);
          const [grader, minG, maxG] = await Promise.all([
            policyContract.requiredGrader().catch(() => ""),
            policyContract.minGrade().catch(() => 0n),
            policyContract.maxGrade().catch(() => 0n),
          ]);

          const graderStr = grader || "Any Grader";
          let gradeStr = "Any Grade";
          if (minG > 0n && maxG > 0n && minG === maxG) {
            gradeStr = `Grade ${minG.toString()}`;
          } else if (minG > 0n && maxG > 0n) {
            gradeStr = `Grade ${minG.toString()} - ${maxG.toString()}`;
          } else if (minG > 0n) {
            gradeStr = `Grade >= ${minG.toString()}`;
          } else if (maxG > 0n) {
            gradeStr = `Grade <= ${maxG.toString()}`;
          }
          policyLabel = `GradeEligibilityPolicy (${graderStr} ${gradeStr}) [${policyAddress}]`;
        } catch {
          policyLabel = `Custom Policy [${policyAddress}]`;
        }
      }

      lendingPoolDetails = {
        poolAddress: lendingPoolAddress,
        poolName,
        poolSymbol,
        assetAddress,
        assetName,
        assetSymbol,
        assetDecimals,
        maxLtvBps,
        maxLtvPercent: (Number(maxLtvBps) / 100).toFixed(2) + "%",
        liquidationThresholdBps,
        liquidationThresholdPercent: (Number(liquidationThresholdBps) / 100).toFixed(2) + "%",
        liquidationPenaltyBps: BigInt(poolLiqPenalty),
        liquidationPenaltyPercent: (Number(poolLiqPenalty) / 100).toFixed(2) + "%",
        borrowRateBpsPerYear: BigInt(poolBorrowRate),
        borrowRatePercent: (Number(poolBorrowRate) / 100).toFixed(2) + "%",
        eligibilityPolicyAddress: policyAddress,
        eligibilityPolicyLabel: policyLabel,
      };
    } catch {
      // Non-critical if lending pool query fails
    }
  }

  // 4. Fetch Collateral Cards & Pricing
  const collateralCards: CollateralCardSummary[] = [];
  try {
    const vaultCardAddress = await loanCoreContract.vaultCard();
    const priceFeedAddress = await loanCoreContract.priceFeed();

    const vaultCardContract = new ethers.Contract(vaultCardAddress, VAULT_CARD_ABI, provider);
    const priceFeedContract =
      priceFeedAddress && priceFeedAddress !== ethers.ZeroAddress
        ? new ethers.Contract(priceFeedAddress, PRICE_FEED_ABI, provider)
        : null;

    for (const tokenId of tokenIdsRaw) {
      try {
        const cardMeta = await vaultCardContract.getCard(tokenId);
        const tokenURI = await vaultCardContract.tokenURI(tokenId).catch(() => "N/A");
        const cardTypeId = cardMeta[1];
        const attestationHash = cardMeta[2];
        const mintTimestamp = BigInt(cardMeta[3]);
        const isLocked = Boolean(cardMeta[4]);

        const mintDate =
          mintTimestamp > 0n
            ? new Date(Number(mintTimestamp) * 1000).toISOString()
            : "N/A";

        let priceRaw: bigint | undefined;
        let priceFormatted: string | undefined;

        if (priceFeedContract) {
          try {
            const isSupported = await priceFeedContract.isSupportedCardType(cardTypeId);
            if (isSupported) {
              const priceData = await priceFeedContract.getPrice(cardTypeId);
              priceRaw = BigInt(priceData[0]);
              priceFormatted = Number(ethers.formatUnits(priceRaw, 18)).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }) + " EUR";
            }
          } catch {
            // Price feed query failed for single card
          }
        }

        collateralCards.push({
          tokenId,
          cardTypeId,
          attestationHash,
          mintTimestamp,
          mintDate,
          isLocked,
          tokenURI,
          priceRaw,
          priceFormatted,
        });
      } catch {
        // Individual card fetch failed
      }
    }
  } catch {
    // VaultCard query failed
  }

  // 5. Query LoanCore Financial State
  const totalFmvRaw = BigInt(await loanCoreContract.getVaultFMV(vaultId).catch(() => 0n));
  const pendingInterest = BigInt(await loanCoreContract.getPendingInterest(vaultId).catch(() => 0n));
  const totalDebt = BigInt(await loanCoreContract.getTotalDebt(vaultId).catch(() => 0n));

  // Compute exact Max Borrow Capacity scaled to asset decimals (totalFmvRaw is in 18 decimals)
  const scale = 10n ** BigInt(18 - assetDecimals);
  const maxBorrowCapacityRaw = (totalFmvRaw * maxLtvBps) / (10000n * scale);

  const remainingBorrow =
    maxBorrowCapacityRaw > totalDebt ? maxBorrowCapacityRaw - totalDebt : 0n;

  // Format financial values:
  // - Total FMV is in EUR (18 decimals from Oracle)
  const totalCollateralFmvFormatted =
    Number(ethers.formatUnits(totalFmvRaw, 18)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " EUR";

  // - LoanCore amounts (debt, capacity) are in underlying asset decimals
  const formatAsset = (val: bigint) =>
    Number(ethers.formatUnits(val, assetDecimals)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " " + assetSymbol;

  const maxBorrowCapacityFormatted = formatAsset(maxBorrowCapacityRaw);
  const principalDebtFormatted = formatAsset(principalDebtRaw);
  const accumulatedInterestFormatted = formatAsset(accumulatedInterestRaw);
  const pendingInterestFormatted = formatAsset(pendingInterest);
  const totalDebtFormatted = formatAsset(totalDebt);
  const remainingBorrowCapacityFormatted = formatAsset(remainingBorrow);

  // Calculate current LTV (normalized to 18 decimals)
  let currentLtvPercent = "0.00%";
  if (totalFmvRaw > 0n && totalDebt > 0n) {
    const scaledDebt = totalDebt * scale;
    const ltvBps = (scaledDebt * 10000n) / totalFmvRaw;
    currentLtvPercent = (Number(ltvBps) / 100).toFixed(2) + "%";
  }

  // Calculate Health Factor with exact precision:
  // HF = (FMV * LiquidationThreshold) / TotalDebt
  let healthFactorFormatted: string;
  let healthStatus: "HEALTHY" | "LIQUIDATABLE" | "NO_DEBT";

  if (totalDebt === 0n) {
    healthFactorFormatted = "∞ (No Active Debt)";
    healthStatus = "NO_DEBT";
  } else {
    const fmvInAsset = totalFmvRaw / scale;
    const hfNumeric = Number(fmvInAsset * liquidationThresholdBps) / Number(totalDebt * 10000n);

    if (hfNumeric >= 1.0) {
      healthFactorFormatted = `${hfNumeric.toFixed(2)} (🟢 HEALTHY)`;
      healthStatus = "HEALTHY";
    } else {
      healthFactorFormatted = `${hfNumeric.toFixed(2)} (🔴 LIQUIDATABLE)`;
      healthStatus = "LIQUIDATABLE";
    }
  }

  return {
    vaultId,
    loanCoreAddress,
    status: statusNum,
    statusLabel,
    owner,
    isOwnerKybApproved,
    lastInterestUpdateTime,
    lastInterestUpdateDate,
    lendingPoolAddress,
    lendingPoolDetails,
    tokenIds: tokenIdsRaw,
    collateralCards,
    totalCollateralFmvRaw: totalFmvRaw,
    totalCollateralFmvFormatted,
    maxBorrowCapacityRaw,
    maxBorrowCapacityFormatted,
    principalDebtRaw,
    principalDebtFormatted,
    accumulatedInterestRaw,
    accumulatedInterestFormatted,
    pendingInterestRaw: pendingInterest,
    pendingInterestFormatted,
    totalDebtRaw: totalDebt,
    totalDebtFormatted,
    remainingBorrowCapacityRaw: remainingBorrow,
    remainingBorrowCapacityFormatted,
    currentLtvPercent,
    healthFactorRaw: totalDebt > 0n ? (totalFmvRaw * liquidationThresholdBps) / (totalDebt * 10000n) : typeMax(),
    healthFactorFormatted,
    healthStatus,
  };
}

function typeMax(): bigint {
  return (1n << 256n) - 1n;
}

/**
 * Format full vault details into a clean, human-readable ASCII summary table.
 */
export function formatVaultDetailsTable(details: VaultDetails): string {
  const separator = "=".repeat(80);
  const subSeparator = "-".repeat(80);

  const lines: string[] = [];
  lines.push(separator);
  lines.push("                         HoloFi Collateral Vault Details                         ");
  lines.push(separator);

  lines.push(`Vault ID           : #${details.vaultId.toString()}`);
  lines.push(`Vault Status       : ${details.statusLabel}`);
  const kybIndicator = details.isOwnerKybApproved ? "(KYB: APPROVED ✅)" : "(KYB: NOT APPROVED ⚠️)";
  lines.push(`Vault Owner (Store): ${details.owner} ${kybIndicator}`);
  lines.push(`Loan Core Contract : ${details.loanCoreAddress}`);
  lines.push(`Last Interest Sync : ${details.lastInterestUpdateDate}`);

  lines.push(subSeparator);
  lines.push("Bound Lending Pool & Risk Configuration:");
  if (details.lendingPoolDetails) {
    const p = details.lendingPoolDetails;
    lines.push(`Lending Pool       : ${p.poolName} (${p.poolSymbol})`);
    lines.push(`Pool Address       : ${p.poolAddress}`);
    lines.push(`Underlying Asset   : ${p.assetName} (${p.assetSymbol}) - ${p.assetAddress}`);
    lines.push(
      `Pool Risk Config   : Max LTV: ${p.maxLtvPercent} | Liq Threshold: ${p.liquidationThresholdPercent} | Liq Penalty: ${p.liquidationPenaltyPercent} | APY: ${p.borrowRatePercent}`
    );
    lines.push(`Eligibility Policy : ${p.eligibilityPolicyLabel}`);
  } else {
    lines.push(`Lending Pool       : ${details.lendingPoolAddress || "None"}`);
  }

  lines.push(subSeparator);
  lines.push("Collateral & Valuation:");
  lines.push(`Deposited Cards    : ${details.tokenIds.length} Card(s)`);
  lines.push(`Total Collateral   : ${details.totalCollateralFmvFormatted}`);
  lines.push(`Max Borrow Limit   : ${details.maxBorrowCapacityFormatted}`);

  if (details.collateralCards.length > 0) {
    lines.push("Collateral Cards   :");
    for (const card of details.collateralCards) {
      const priceStr = card.priceFormatted ? ` | FMV: ${card.priceFormatted}` : " | FMV: [Unpriced]";
      const uriStr = card.tokenURI && card.tokenURI !== "N/A" ? ` | URI: ${card.tokenURI}` : "";
      lines.push(`  • Token #${card.tokenId.toString()} [${card.cardTypeId}]${priceStr}${uriStr}`);
    }
  } else {
    lines.push("Collateral Cards   : [No Collateral Deposited]");
  }

  lines.push(subSeparator);
  lines.push("Debt & Financial Health:");
  lines.push(`Principal Debt     : ${details.principalDebtFormatted}`);
  lines.push(`Accumulated Interest: ${details.accumulatedInterestFormatted}`);
  lines.push(`Pending Interest   : ${details.pendingInterestFormatted}`);
  lines.push(`Total Debt         : ${details.totalDebtFormatted}`);
  lines.push(`Remaining Borrow   : ${details.remainingBorrowCapacityFormatted}`);
  lines.push(`Current LTV        : ${details.currentLtvPercent}`);
  lines.push(`Health Factor (HF) : ${details.healthFactorFormatted}`);
  lines.push(separator);

  return lines.join("\n");
}

/**
 * Print CLI help guide.
 */
export function printHelp(): void {
  console.log(`
HoloFi Vault Details Viewer CLI

USAGE:
  npm run view-vault -- <vaultId> [loanCoreAddress] [--network <network>]
  # or
  npx tsx scripts/view-vault.ts <vaultId> [loanCoreAddress] [--network <network>]
  # or
  VAULT_ID=<vaultId> npx hardhat run scripts/view-vault.ts --network <network>

OPTIONS:
  <vaultId>                  Numeric ID of the collateral vault to inspect (e.g. 1)
  [loanCoreAddress]          Optional HoloFiVaultLoanCore contract address
  --loan-core, -l <address>  Explicitly specify HoloFiVaultLoanCore contract address
  --network, -n <network>    Target network (default: localhost)
  --help, -h                 Display this help guide

EXAMPLES:
  # View details for Vault #1 on localhost
  npm run view-vault 1

  # View details for Vault #2 with explicit loan core address
  npx tsx scripts/view-vault.ts 2 0x5FbDB2315678afecb367f032d93F642f64180aa3

  # View details for Vault #1 on Base Sepolia testnet
  npm run view-vault -- 1 --network baseSepolia
  npx tsx scripts/view-vault.ts 1 --network baseSepolia
`);
}

/**
 * Main script execution function.
 */
export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  if (args.vaultId === undefined) {
    console.error("[ERROR] Missing required vault ID.");
    console.error("Usage: npm run view-vault <vaultId> [--network <network>]");
    console.error("Run 'npm run view-vault -- --help' for details.");
    process.exit(1);
  }

  const targetNetwork = args.networkName || process.env.HARDHAT_NETWORK || "localhost";
  console.log(`[INFO] Connecting to network '${targetNetwork}'...`);

  let provider: ethers.Provider;
  try {
    const hardhatNetwork = await network.create(targetNetwork);
    provider = hardhatNetwork.ethers.provider;
  } catch {
    provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
  }

  const projectRoot = process.cwd();
  let loanCoreAddress: string;

  try {
    loanCoreAddress = await resolveLoanCoreAddress(provider, projectRoot, args.loanCoreAddress);
  } catch (err: any) {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  }

  const bytecode = await provider.getCode(loanCoreAddress);
  if (!bytecode || bytecode === "0x") {
    console.error(`[ERROR] No contract bytecode found at HoloFiVaultLoanCore address ${loanCoreAddress}`);
    process.exit(1);
  }

  console.log(`[INFO] Querying Vault #${args.vaultId.toString()} on LoanCore (${loanCoreAddress})...\n`);

  try {
    const loanCoreContract = new ethers.Contract(loanCoreAddress, LOAN_CORE_ABI, provider);
    const details = await fetchVaultDetails(provider, loanCoreContract, args.vaultId);
    console.log(formatVaultDetailsTable(details));
  } catch (err: any) {
    console.error(`[ERROR] Failed to fetch vault details: ${err.message}`);
    process.exit(1);
  }
}

// Execute main if run directly via tsx / node / hardhat
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && process.argv[1].endsWith("view-vault.ts")) ||
  (process.argv[1] && process.argv[1].endsWith("view-vault.js"));

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
