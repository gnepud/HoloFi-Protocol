import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { network } from "hardhat";

export const VAULT_CARD_ABI = [
  "function getCard(uint256 tokenId) external view returns (tuple(uint256 tokenId, bytes32 cardTypeId, bytes32 attestationHash, uint256 mintTimestamp, bool isLocked))",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function verifyAttestation(uint256 tokenId, bytes calldata rawData) external view returns (bool)",
  "function nextTokenId() external view returns (uint256)",
  "function acm() external view returns (address)",
];

export const PRICE_FEED_ABI = [
  "function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated)",
  "function isSupportedCardType(bytes32 cardTypeId) external view returns (bool)",
];

export const LOAN_CORE_ABI = [
  "function nftVaultId(uint256 tokenId) external view returns (uint256)",
  "function getVault(uint256 vaultId) external view returns (tuple(uint256 vaultId, address owner, uint256[] tokenIds, uint256 principalDebt, uint256 accumulatedInterest, uint256 lastInterestUpdateTime, uint8 status))",
];

export interface CardMetadata {
  tokenId: bigint;
  cardTypeId: string;
  attestationHash: string;
  mintTimestamp: bigint;
  isLocked: boolean;
}

export interface CardPriceInfo {
  priceRaw: bigint;
  priceFormatted: string;
  lastUpdated: bigint;
  lastUpdatedDate: string;
}

export interface VaultLockInfo {
  vaultId: bigint;
  vaultOwner: string;
  loanCoreAddress: string;
  vaultStatus: "Active" | "Liquidating" | "Closed" | "Unknown";
  principalDebt?: bigint;
  accumulatedInterest?: bigint;
}

export interface CardDetails {
  tokenId: bigint;
  contractAddress: string;
  contractName: string;
  contractSymbol: string;
  owner: string;
  tokenURI: string;
  cardTypeId: string;
  attestationHash: string;
  mintTimestamp: bigint;
  mintDate: string;
  isLocked: boolean;
  priceFeedAddress?: string;
  priceInfo?: CardPriceInfo;
  loanCoreAddress?: string;
  vaultLockInfo?: VaultLockInfo;
}

export interface ParsedCliArgs {
  tokenId?: bigint;
  vaultCardAddress?: string;
  priceFeedAddress?: string;
  loanCoreAddress?: string;
  networkName?: string;
  help?: boolean;
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
      if (
        (arg === "--contract" ||
          arg === "-c" ||
          arg === "--vault-card" ||
          arg === "--card") &&
        i + 1 < argv.length
      ) {
        result.vaultCardAddress = argv[++i];
        continue;
      }
      if (arg.startsWith("--contract=") || arg.startsWith("--vault-card=") || arg.startsWith("--card=")) {
        result.vaultCardAddress = arg.split("=")[1];
        continue;
      }
      if (
        (arg === "--price-feed" || arg === "--pricefeed" || arg === "-p") &&
        i + 1 < argv.length
      ) {
        result.priceFeedAddress = argv[++i];
        continue;
      }
      if (arg.startsWith("--price-feed=") || arg.startsWith("--pricefeed=")) {
        result.priceFeedAddress = arg.split("=")[1];
        continue;
      }
      if (
        (arg === "--loan-core" || arg === "--loancore" || arg === "-l") &&
        i + 1 < argv.length
      ) {
        result.loanCoreAddress = argv[++i];
        continue;
      }
      if (arg.startsWith("--loan-core=") || arg.startsWith("--loancore=")) {
        result.loanCoreAddress = arg.split("=")[1];
        continue;
      }
      if (
        arg === "run" ||
        arg.endsWith(".ts") ||
        arg.endsWith(".js") ||
        arg.endsWith("tsx") ||
        arg === "view-card"
      ) {
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
    } else if (
      (token === "--contract" ||
        token === "-c" ||
        token === "--vault-card" ||
        token === "--card") &&
      i + 1 < tokens.length
    ) {
      result.vaultCardAddress = tokens[++i];
    } else if (
      token.startsWith("--contract=") ||
      token.startsWith("--vault-card=") ||
      token.startsWith("--card=")
    ) {
      result.vaultCardAddress = token.split("=")[1];
    } else if (
      (token === "--price-feed" || token === "--pricefeed" || token === "-p") &&
      i + 1 < tokens.length
    ) {
      result.priceFeedAddress = tokens[++i];
    } else if (token.startsWith("--price-feed=") || token.startsWith("--pricefeed=")) {
      result.priceFeedAddress = token.split("=")[1];
    } else if (
      (token === "--loan-core" || token === "--loancore" || token === "-l") &&
      i + 1 < tokens.length
    ) {
      result.loanCoreAddress = tokens[++i];
    } else if (token.startsWith("--loan-core=") || token.startsWith("--loancore=")) {
      result.loanCoreAddress = token.split("=")[1];
    } else if (!token.startsWith("-")) {
      positional.push(token);
    }
  }

  // Parse positional arguments:
  // 1. First positional: tokenId (if numeric) or contract address
  // 2. Second positional: vaultCardAddress (if address)
  // 3. Third positional: priceFeedAddress (if address)
  if (positional.length > 0) {
    const first = positional[0].trim();
    if (/^\d+$/.test(first)) {
      result.tokenId = BigInt(first);
    } else if (ethers.isAddress(first)) {
      result.vaultCardAddress = first;
    }
  }

  if (positional.length > 1) {
    const second = positional[1].trim();
    if (ethers.isAddress(second)) {
      if (!result.vaultCardAddress) {
        result.vaultCardAddress = second;
      } else if (!result.priceFeedAddress) {
        result.priceFeedAddress = second;
      }
    } else if (/^\d+$/.test(second) && result.tokenId === undefined) {
      result.tokenId = BigInt(second);
    }
  }

  if (positional.length > 2) {
    const third = positional[2].trim();
    if (ethers.isAddress(third) && !result.priceFeedAddress) {
      result.priceFeedAddress = third;
    }
  }

  // Fallbacks to environment variables
  if (result.tokenId === undefined) {
    const envTokenId = process.env.TOKEN_ID || process.env.CARD_TOKEN_ID || process.env.ID;
    if (envTokenId && /^\d+$/.test(envTokenId.trim())) {
      result.tokenId = BigInt(envTokenId.trim());
    }
  }

  if (!result.vaultCardAddress) {
    const envCard =
      process.env.VAULT_CARD_ADDRESS ||
      process.env.CARD_ADDRESS ||
      process.env.CONTRACT_ADDRESS;
    if (envCard && ethers.isAddress(envCard.trim())) {
      result.vaultCardAddress = envCard.trim();
    }
  }

  if (!result.priceFeedAddress) {
    const envFeed = process.env.PRICE_FEED_ADDRESS || process.env.FEED_ADDRESS;
    if (envFeed && ethers.isAddress(envFeed.trim())) {
      result.priceFeedAddress = envFeed.trim();
    }
  }

  if (!result.loanCoreAddress) {
    const envLoanCore =
      process.env.LOAN_CORE_ADDRESS ||
      process.env.VAULT_LOAN_CORE_ADDRESS;
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
 * Resolve HoloFiVaultCard contract address with precedence:
 * 1. CLI argument
 * 2. Environment variable VAULT_CARD_ADDRESS / CARD_ADDRESS / CONTRACT_ADDRESS
 * 3. Ignition deployment files
 */
export async function resolveVaultCardAddress(
  provider: ethers.Provider,
  cliAddress?: string,
  projectRoot: string = process.cwd()
): Promise<string> {
  if (cliAddress && ethers.isAddress(cliAddress)) {
    return ethers.getAddress(cliAddress);
  }

  if (
    process.env.VAULT_CARD_ADDRESS &&
    ethers.isAddress(process.env.VAULT_CARD_ADDRESS)
  ) {
    return ethers.getAddress(process.env.VAULT_CARD_ADDRESS);
  }

  if (process.env.CARD_ADDRESS && ethers.isAddress(process.env.CARD_ADDRESS)) {
    return ethers.getAddress(process.env.CARD_ADDRESS);
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

    // 1. Check exact chain deployment file
    const chainDeploymentPath = path.resolve(
      projectRoot,
      `ignition/deployments/chain-${chainId}/deployed_addresses.json`
    );
    if (fs.existsSync(chainDeploymentPath)) {
      const data = JSON.parse(fs.readFileSync(chainDeploymentPath, "utf-8"));
      for (const [key, addr] of Object.entries(data)) {
        if (
          (key === "DeployHoloFiProtocol#HoloFiVaultCard" ||
            key === "HoloFiVaultCard" ||
            key.includes("HoloFiVaultCard") ||
            key.includes("VaultCard")) &&
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
          const file = path.join(
            deploymentsDir,
            entry.name,
            "deployed_addresses.json"
          );
          if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, "utf-8"));
            for (const [key, addr] of Object.entries(data)) {
              if (
                (key === "DeployHoloFiProtocol#HoloFiVaultCard" ||
                  key === "HoloFiVaultCard" ||
                  key.includes("HoloFiVaultCard") ||
                  key.includes("VaultCard")) &&
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
          (key === "DeployHoloFiProtocol#HoloFiVaultCard" ||
            key === "HoloFiVaultCard" ||
            key.includes("HoloFiVaultCard") ||
            key.includes("VaultCard")) &&
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
    "Could not resolve HoloFiVaultCard contract address. Please provide it as a CLI argument, set VAULT_CARD_ADDRESS in your environment, or deploy the protocol via Ignition."
  );
}

/**
 * Resolve HoloFiCardPriceFeed contract address with precedence:
 * 1. CLI argument
 * 2. Environment variable PRICE_FEED_ADDRESS / FEED_ADDRESS
 * 3. Ignition deployment files
 */
export async function resolvePriceFeedAddress(
  provider: ethers.Provider,
  projectRoot: string = process.cwd(),
  cliAddress?: string
): Promise<string | null> {
  if (cliAddress && ethers.isAddress(cliAddress)) {
    return ethers.getAddress(cliAddress);
  }

  if (
    process.env.PRICE_FEED_ADDRESS &&
    ethers.isAddress(process.env.PRICE_FEED_ADDRESS)
  ) {
    return ethers.getAddress(process.env.PRICE_FEED_ADDRESS);
  }

  if (
    process.env.FEED_ADDRESS &&
    ethers.isAddress(process.env.FEED_ADDRESS)
  ) {
    return ethers.getAddress(process.env.FEED_ADDRESS);
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
          (key === "DeployHoloFiProtocol#HoloFiCardPriceFeed" ||
            key === "HoloFiCardPriceFeed" ||
            key.includes("HoloFiCardPriceFeed") ||
            key.includes("CardPriceFeed")) &&
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
          const file = path.join(
            deploymentsDir,
            entry.name,
            "deployed_addresses.json"
          );
          if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, "utf-8"));
            for (const [key, addr] of Object.entries(data)) {
              if (
                (key === "DeployHoloFiProtocol#HoloFiCardPriceFeed" ||
                  key === "HoloFiCardPriceFeed" ||
                  key.includes("HoloFiCardPriceFeed") ||
                  key.includes("CardPriceFeed")) &&
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
          (key === "DeployHoloFiProtocol#HoloFiCardPriceFeed" ||
            key === "HoloFiCardPriceFeed" ||
            key.includes("HoloFiCardPriceFeed") ||
            key.includes("CardPriceFeed")) &&
          typeof addr === "string" &&
          ethers.isAddress(addr)
        ) {
          return ethers.getAddress(addr);
        }
      }
    }
  } catch {
    // Continue to return null
  }

  return null;
}

/**
 * Resolve HoloFiVaultLoanCore contract address with precedence:
 * 1. CLI argument
 * 2. Environment variable LOAN_CORE_ADDRESS / VAULT_LOAN_CORE_ADDRESS
 * 3. Ignition deployment files
 */
export async function resolveLoanCoreAddress(
  provider: ethers.Provider,
  projectRoot: string = process.cwd(),
  cliAddress?: string
): Promise<string | null> {
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
          (key === "DeployHoloFiProtocol#HoloFiVaultLoanCore" ||
            key === "HoloFiVaultLoanCore" ||
            key.includes("HoloFiVaultLoanCore") ||
            key.includes("VaultLoanCore") ||
            key.includes("LoanCore")) &&
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
          const file = path.join(
            deploymentsDir,
            entry.name,
            "deployed_addresses.json"
          );
          if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, "utf-8"));
            for (const [key, addr] of Object.entries(data)) {
              if (
                (key === "DeployHoloFiProtocol#HoloFiVaultLoanCore" ||
                  key === "HoloFiVaultLoanCore" ||
                  key.includes("HoloFiVaultLoanCore") ||
                  key.includes("VaultLoanCore") ||
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
            key.includes("VaultLoanCore") ||
            key.includes("LoanCore")) &&
          typeof addr === "string" &&
          ethers.isAddress(addr)
        ) {
          return ethers.getAddress(addr);
        }
      }
    }
  } catch {
    // Continue to return null
  }

  return null;
}

/**
 * Fetch full card details from contract, optional price feed, and optional loan core.
 */
export async function fetchCardDetails(
  vaultCard: ethers.Contract | ethers.BaseContract | any,
  tokenId: bigint | number,
  priceFeed?: ethers.Contract | ethers.BaseContract | any | null,
  loanCore?: ethers.Contract | ethers.BaseContract | any | null
): Promise<CardDetails> {
  const id = BigInt(tokenId);
  const contractAddress = await vaultCard.getAddress();

  const [contractName, contractSymbol, owner, tokenURI, cardStruct] =
    await Promise.all([
      vaultCard.name().catch(() => "HoloFiVaultCard"),
      vaultCard.symbol().catch(() => "HFC"),
      vaultCard.ownerOf(id),
      vaultCard.tokenURI(id).catch(() => ""),
      vaultCard.getCard(id),
    ]);

  const cardTypeId = (cardStruct.cardTypeId ?? cardStruct[1]) as string;
  const attestationHash = (cardStruct.attestationHash ?? cardStruct[2]) as string;
  const mintTimestamp = BigInt(cardStruct.mintTimestamp ?? cardStruct[3]);
  const isLocked = Boolean(cardStruct.isLocked ?? cardStruct[4]);

  const mintDate =
    mintTimestamp > 0n
      ? new Date(Number(mintTimestamp) * 1000).toISOString()
      : "N/A";

  let priceInfo: CardPriceInfo | undefined;
  let priceFeedAddress: string | undefined;

  if (priceFeed) {
    try {
      priceFeedAddress = await priceFeed.getAddress();
      const [priceRaw, lastUpdatedRaw] = await priceFeed.getPrice(cardTypeId);
      const priceBigInt = BigInt(priceRaw);
      const lastUpdated = BigInt(lastUpdatedRaw);

      const formattedUnits = ethers.formatUnits(priceBigInt, 18);
      const formattedNum = Number(formattedUnits);
      const priceFormatted =
        priceBigInt > 0n
          ? `$${formattedNum.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} USD (${formattedUnits} USD)`
          : "$0.00 USD (Not set)";

      const lastUpdatedDate =
        lastUpdated > 0n
          ? new Date(Number(lastUpdated) * 1000).toISOString()
          : "N/A";

      priceInfo = {
        priceRaw: priceBigInt,
        priceFormatted,
        lastUpdated,
        lastUpdatedDate,
      };
    } catch {
      // Gracefully handle case where price feed call fails or cardTypeId not registered
    }
  }

  let loanCoreAddress: string | undefined;
  let vaultLockInfo: VaultLockInfo | undefined;

  if (loanCore) {
    try {
      const coreAddress = await loanCore.getAddress();
      loanCoreAddress = coreAddress;
      const vaultIdRaw = await loanCore.nftVaultId(id);
      const vaultId = BigInt(vaultIdRaw);

      if (vaultId > 0n) {
        const vaultStruct = await loanCore.getVault(vaultId);
        const vaultOwner = (vaultStruct.owner ?? vaultStruct[1]) as string;
        const statusNum = Number(vaultStruct.status ?? vaultStruct[6]);
        let vaultStatus: "Active" | "Liquidating" | "Closed" | "Unknown";
        if (statusNum === 0) {
          vaultStatus = "Active";
        } else if (statusNum === 1) {
          vaultStatus = "Liquidating";
        } else if (statusNum === 2) {
          vaultStatus = "Closed";
        } else {
          vaultStatus = "Unknown";
        }

        const principalDebt = BigInt(
          vaultStruct.principalDebt ?? vaultStruct[3] ?? 0n
        );
        const accumulatedInterest = BigInt(
          vaultStruct.accumulatedInterest ?? vaultStruct[4] ?? 0n
        );

        vaultLockInfo = {
          vaultId,
          vaultOwner,
          loanCoreAddress: coreAddress,
          vaultStatus,
          principalDebt,
          accumulatedInterest,
        };
      }
    } catch {
      // Gracefully handle case where loan core call fails or not applicable
    }
  }

  return {
    tokenId: id,
    contractAddress,
    contractName,
    contractSymbol,
    owner,
    tokenURI,
    cardTypeId,
    attestationHash,
    mintTimestamp,
    mintDate,
    isLocked,
    priceFeedAddress,
    priceInfo,
    loanCoreAddress,
    vaultLockInfo,
  };
}

/**
 * Format CardDetails into an ASCII summary table string.
 */
export function formatCardDetailsTable(details: CardDetails): string {
  const border = "=".repeat(80);
  const divider = "-".repeat(80);

  const lines: string[] = [
    border,
    "                         HoloFi Vault Card NFT Metadata                         ",
    border,
    `Token ID           : ${details.tokenId.toString()}`,
    `Contract           : ${details.contractAddress} (${details.contractName} - ${details.contractSymbol})`,
    `Owner Address      : ${details.owner}`,
  ];

  if (details.isLocked && details.vaultLockInfo) {
    lines.push(
      `Lock Status        : LOCKED [In Escrow / Collateralized]`,
      `Locked in Vault    : Vault #${details.vaultLockInfo.vaultId.toString()} (Status: ${details.vaultLockInfo.vaultStatus})`,
      `Vault Owner (Store): ${details.vaultLockInfo.vaultOwner}`,
      `Loan Core Escrow   : ${details.vaultLockInfo.loanCoreAddress}`
    );
  } else {
    const lockStatus = details.isLocked
      ? "LOCKED [In Escrow / Collateralized]"
      : "UNLOCKED [Free / Transferable]";
    lines.push(`Lock Status        : ${lockStatus}`);
  }

  lines.push(
    `Minted At          : ${details.mintDate} (Unix: ${details.mintTimestamp.toString()})`,
    `Token URI          : ${details.tokenURI || "(empty)"}`,
    divider,
    "ASSET & ATTESTATION DETAILS",
    divider,
    `Card Type ID       : ${details.cardTypeId}`,
    `Attestation Hash   : ${details.attestationHash}`,
    divider,
    "ORACLE VALUATION (FMV)",
    divider
  );

  if (details.priceInfo && details.priceFeedAddress) {
    lines.push(
      `Price Feed         : ${details.priceFeedAddress}`,
      `Fair Market Value  : ${details.priceInfo.priceFormatted}`,
      `Last Updated       : ${details.priceInfo.lastUpdatedDate} (Unix: ${details.priceInfo.lastUpdated.toString()})`
    );
  } else if (details.priceFeedAddress) {
    lines.push(
      `Price Feed         : ${details.priceFeedAddress}`,
      `Fair Market Value  : Not available or card type unpriced in registry`
    );
  } else {
    lines.push(
      `Price Feed         : Not configured / unavailable`,
      `Fair Market Value  : N/A`
    );
  }

  lines.push(border);
  return lines.join("\n");
}

/**
 * Print detailed CLI usage and help guide.
 */
export function printHelp(): void {
  console.log(`
HoloFi Protocol - Vault Card NFT Inspector CLI
============================================================

View on-chain metadata, asset attestation hashes, lock status,
and oracle valuation for any HoloFiVaultCard NFT.

Usage:
  npm run view-card <tokenId> [vaultCardAddress] [options]
  npx tsx scripts/view-card.ts <tokenId> [vaultCardAddress] [options]
  TOKEN_ID=<tokenId> npx hardhat run scripts/view-card.ts --network <network>

Positional Arguments:
  <tokenId>               Token ID of the HoloFiVaultCard (required non-negative integer)
  [vaultCardAddress]      Optional HoloFiVaultCard contract address (defaults to auto-detection)

Options:
  --contract, -c <addr>   Specify HoloFiVaultCard contract address
  --price-feed, -p <addr> Specify HoloFiCardPriceFeed contract address
  --loan-core, -l <addr>  Specify HoloFiVaultLoanCore contract address
  --network, -n <net>     Target network (e.g. localhost, sepolia, mainnet). Default: localhost
  --help, -h              Show this help message

Environment Variables:
  TOKEN_ID                Default token ID if not provided as argument
  VAULT_CARD_ADDRESS      Default HoloFiVaultCard contract address
  PRICE_FEED_ADDRESS      Default HoloFiCardPriceFeed contract address
  LOAN_CORE_ADDRESS       Default HoloFiVaultLoanCore contract address
  HARDHAT_NETWORK         Default network to connect to

Examples:
  npm run view-card 1
  npm run view-card 1 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
  npm run view-card 1 --network sepolia
  npx tsx scripts/view-card.ts 2 --contract 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
  TOKEN_ID=1 npx hardhat run scripts/view-card.ts --network localhost
`);
}

/**
 * Main CLI execution entrypoint.
 */
export async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    printHelp();
    return;
  }

  if (args.tokenId === undefined) {
    console.error("\n[ERROR] Missing required tokenId argument.");
    printHelp();
    process.exit(1);
  }

  const targetNetwork =
    args.networkName || process.env.HARDHAT_NETWORK || "localhost";
  let connection;
  try {
    connection = await network.connect({ network: targetNetwork });
  } catch (err) {
    throw new Error(
      `Failed to connect to network "${targetNetwork}": ${
        err instanceof Error ? err.message : err
      }. If targeting localhost, ensure a local RPC node is running (e.g. npx hardhat node).`
    );
  }

  const { ethers: hhEthers } = connection;
  const signers = await hhEthers.getSigners();
  const signer = signers.length > 0 ? signers[0] : null;
  const provider = signer ? signer.provider : hhEthers.provider;

  if (!provider) {
    throw new Error(
      `Unable to establish provider connection to network "${targetNetwork}".`
    );
  }

  const vaultCardAddress = await resolveVaultCardAddress(
    provider,
    args.vaultCardAddress
  );

  // Validate contract bytecode existence
  const code = await provider.getCode(vaultCardAddress);
  if (code === "0x" || code === "0x0") {
    throw new Error(
      `No contract bytecode deployed at HoloFiVaultCard address ${vaultCardAddress} on network "${targetNetwork}".\n` +
        `Please ensure that:\n` +
        `  1. Your local node is running (e.g. npx hardhat node)\n` +
        `  2. Contracts are deployed on "${targetNetwork}" (e.g. npx hardhat ignition deploy ignition/modules/DeployHoloFiProtocol.ts --network ${targetNetwork})\n` +
        `  3. You are pointing to the correct network (--network <network>) or address (--contract <address>)`
    );
  }

  const priceFeedAddress = await resolvePriceFeedAddress(
    provider,
    process.cwd(),
    args.priceFeedAddress
  );

  const loanCoreAddress = await resolveLoanCoreAddress(
    provider,
    process.cwd(),
    args.loanCoreAddress
  );

  const vaultCard = new ethers.Contract(
    vaultCardAddress,
    VAULT_CARD_ABI,
    signer || provider
  );

  const priceFeed = priceFeedAddress
    ? new ethers.Contract(priceFeedAddress, PRICE_FEED_ABI, signer || provider)
    : null;

  const loanCore = loanCoreAddress
    ? new ethers.Contract(loanCoreAddress, LOAN_CORE_ABI, signer || provider)
    : null;

  try {
    const details = await fetchCardDetails(
      vaultCard,
      args.tokenId,
      priceFeed,
      loanCore
    );
    console.log("\n" + formatCardDetailsTable(details) + "\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("TokenDoesNotExist") ||
      msg.includes("ERC721NonexistentToken") ||
      msg.includes("owner query for nonexistent token")
    ) {
      console.error(
        `\n[ERROR] Token ID #${args.tokenId.toString()} does not exist or has been burned on contract ${vaultCardAddress}.\n`
      );
      process.exit(1);
    }
    throw err;
  }
}

// Auto-run if executed directly as CLI script
const isDirectScriptExecution =
  process.argv.some(
    (arg) => arg.includes("view-card.ts") || arg.includes("view-card.js")
  ) && !process.env.npm_lifecycle_event?.includes("test");

if (isDirectScriptExecution) {
  main().catch((error) => {
    console.error(
      "\n[FATAL ERROR]:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  });
}
