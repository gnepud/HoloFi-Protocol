import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { network } from "hardhat";

export const MOCK_ERC20_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
];

export interface ParsedCliArgs {
  action?: string;
  recipientAddress?: string;
  amountStr?: string;
  tokenAddress?: string;
  networkName?: string;
  help?: boolean;
}

export interface MintResult {
  recipientAddress: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  mintedAmount: bigint;
  mintedFormatted: string;
  initialBalance: bigint;
  initialBalanceFormatted: string;
  newBalance: bigint;
  newBalanceFormatted: string;
  txHash: string;
  blockNumber: number;
}

export interface BalanceResult {
  targetAddress: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  balance: bigint;
  balanceFormatted: string;
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
        (arg === "--token" ||
          arg === "-t" ||
          arg === "--contract" ||
          arg === "-c") &&
        i + 1 < argv.length
      ) {
        result.tokenAddress = argv[++i];
        continue;
      }
      if (arg.startsWith("--token=") || arg.startsWith("--contract=")) {
        result.tokenAddress = arg.split("=")[1];
        continue;
      }
      if ((arg === "--amount" || arg === "-a") && i + 1 < argv.length) {
        result.amountStr = argv[++i];
        continue;
      }
      if (arg.startsWith("--amount=")) {
        result.amountStr = arg.split("=")[1];
        continue;
      }
      if (
        arg === "run" ||
        arg.endsWith(".ts") ||
        arg.endsWith(".js") ||
        arg.endsWith("tsx") ||
        arg === "mint-mock-token"
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
      (token === "--token" ||
        token === "-t" ||
        token === "--contract" ||
        token === "-c") &&
      i + 1 < tokens.length
    ) {
      result.tokenAddress = tokens[++i];
    } else if (token.startsWith("--token=") || token.startsWith("--contract=")) {
      result.tokenAddress = token.split("=")[1];
    } else if ((token === "--amount" || token === "-a") && i + 1 < tokens.length) {
      result.amountStr = tokens[++i];
    } else if (token.startsWith("--amount=")) {
      result.amountStr = token.split("=")[1];
    } else if (!token.startsWith("-")) {
      positional.push(token);
    }
  }

  if (positional.length > 0) {
    const first = positional[0].toLowerCase();
    if (first === "balance" || first === "check" || first === "status" || first === "view") {
      result.action = "balance";
      if (positional.length > 1) {
        result.recipientAddress = positional[1];
      }
      if (positional.length > 2 && ethers.isAddress(positional[2])) {
        result.tokenAddress = positional[2];
      }
    } else if (first === "mint" || first === "add") {
      result.action = "mint";
      if (positional.length > 1) {
        result.recipientAddress = positional[1];
      }
      if (positional.length > 2) {
        const second = positional[2];
        if (ethers.isAddress(second) && !result.tokenAddress) {
          result.tokenAddress = second;
        } else if (!result.amountStr) {
          result.amountStr = second;
        }
      }
      if (positional.length > 3) {
        const third = positional[3];
        if (ethers.isAddress(third) && !result.tokenAddress) {
          result.tokenAddress = third;
        }
      }
    } else if (ethers.isAddress(positional[0])) {
      result.action = "mint";
      result.recipientAddress = positional[0];
      if (positional.length > 1) {
        const second = positional[1];
        if (ethers.isAddress(second) && !result.tokenAddress) {
          result.tokenAddress = second;
        } else if (!result.amountStr) {
          result.amountStr = second;
        }
      }
      if (positional.length > 2) {
        const third = positional[2];
        if (ethers.isAddress(third) && !result.tokenAddress) {
          result.tokenAddress = third;
        }
      }
    } else {
      // Non-address first token (e.g. unknown action or unparseable recipient)
      result.action = positional[0];
      if (positional.length > 1) {
        result.recipientAddress = positional[1];
      }
      if (positional.length > 2) {
        result.amountStr = positional[2];
      }
      if (positional.length > 3 && ethers.isAddress(positional[3])) {
        result.tokenAddress = positional[3];
      }
    }
  }

  // Fallback to environment variables
  if (!result.action && process.env.ACTION) {
    result.action = process.env.ACTION.trim().toLowerCase();
  }

  if (!result.recipientAddress) {
    const envRecipient =
      process.env.RECIPIENT ||
      process.env.ACCOUNT ||
      process.env.TARGET_ADDRESS ||
      process.env.TARGET ||
      process.env.WALLET;
    if (envRecipient) {
      result.recipientAddress = envRecipient.trim();
    }
  }

  if (!result.amountStr) {
    const envAmount = process.env.AMOUNT;
    if (envAmount) {
      result.amountStr = envAmount.trim();
    } else if (result.action === "mint" || (!result.action && result.recipientAddress)) {
      result.amountStr = "10000";
    }
  }

  if (!result.tokenAddress) {
    const envToken =
      process.env.MOCK_ERC20_ADDRESS ||
      process.env.TOKEN_ADDRESS ||
      process.env.MOCK_TOKEN_ADDRESS ||
      process.env.CONTRACT_ADDRESS;
    if (envToken && ethers.isAddress(envToken.trim())) {
      result.tokenAddress = envToken.trim();
    }
  }

  if (!result.networkName && process.env.HARDHAT_NETWORK) {
    result.networkName = process.env.HARDHAT_NETWORK.trim();
  }

  return result;
}

/**
 * Resolve MockERC20 contract address with precedence:
 * 1. CLI argument
 * 2. Environment variable MOCK_ERC20_ADDRESS / TOKEN_ADDRESS / MOCK_TOKEN_ADDRESS / CONTRACT_ADDRESS
 * 3. Ignition deployment files
 */
export async function resolveMockTokenAddress(
  provider?: ethers.Provider,
  cliAddress?: string,
  projectRoot: string = process.cwd(),
  networkName?: string
): Promise<string> {
  if (cliAddress && ethers.isAddress(cliAddress)) {
    return ethers.getAddress(cliAddress);
  }

  if (process.env.MOCK_ERC20_ADDRESS && ethers.isAddress(process.env.MOCK_ERC20_ADDRESS)) {
    return ethers.getAddress(process.env.MOCK_ERC20_ADDRESS);
  }

  if (process.env.TOKEN_ADDRESS && ethers.isAddress(process.env.TOKEN_ADDRESS)) {
    return ethers.getAddress(process.env.TOKEN_ADDRESS);
  }

  if (process.env.MOCK_TOKEN_ADDRESS && ethers.isAddress(process.env.MOCK_TOKEN_ADDRESS)) {
    return ethers.getAddress(process.env.MOCK_TOKEN_ADDRESS);
  }

  if (process.env.CONTRACT_ADDRESS && ethers.isAddress(process.env.CONTRACT_ADDRESS)) {
    return ethers.getAddress(process.env.CONTRACT_ADDRESS);
  }

  let chainId: string | null = null;
  if (provider && typeof provider.getNetwork === "function") {
    try {
      const networkInfo = await provider.getNetwork();
      chainId = networkInfo.chainId.toString();
    } catch {
      // Ignore RPC failure
    }
  }

  if (!chainId && networkName) {
    const knownNetworks: Record<string, string> = {
      baseSepolia: "84532",
      basesepolia: "84532",
      baseMainnet: "8453",
      basemainnet: "8453",
      base: "8453",
      sepolia: "11155111",
      mainnet: "1",
      localhost: "31337",
      hardhat: "31337",
    };
    if (knownNetworks[networkName]) {
      chainId = knownNetworks[networkName];
    }
  }

  // 1. Check exact chain deployment file
  if (chainId) {
    const chainDeploymentPath = path.resolve(
      projectRoot,
      `ignition/deployments/chain-${chainId}/deployed_addresses.json`
    );
    if (fs.existsSync(chainDeploymentPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(chainDeploymentPath, "utf-8"));
        for (const [key, addr] of Object.entries(data)) {
          if (
            (key === "DeployHoloFiLendingPoolWithMock#MockERC20" ||
              key === "MockERC20" ||
              key.includes("MockERC20") ||
              key.includes("mockAsset") ||
              key.includes("MockToken")) &&
            typeof addr === "string" &&
            ethers.isAddress(addr)
          ) {
            return ethers.getAddress(addr);
          }
        }
      } catch {}
    }
  }

  // 2. Search all ignition deployments directories
  const deploymentsDir = path.resolve(projectRoot, "ignition/deployments");
  if (fs.existsSync(deploymentsDir)) {
    try {
      const entries = fs.readdirSync(deploymentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const file = path.join(deploymentsDir, entry.name, "deployed_addresses.json");
          if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, "utf-8"));
            for (const [key, addr] of Object.entries(data)) {
              if (
                (key === "DeployHoloFiLendingPoolWithMock#MockERC20" ||
                  key === "MockERC20" ||
                  key.includes("MockERC20") ||
                  key.includes("mockAsset") ||
                  key.includes("MockToken")) &&
                typeof addr === "string" &&
                ethers.isAddress(addr)
              ) {
                return ethers.getAddress(addr);
              }
            }
          }
        }
      }
    } catch {}
  }

  // 3. Search root deployed_addresses.json
  const rootDeployed = path.resolve(projectRoot, "deployed_addresses.json");
  if (fs.existsSync(rootDeployed)) {
    try {
      const data = JSON.parse(fs.readFileSync(rootDeployed, "utf-8"));
      for (const [key, addr] of Object.entries(data)) {
        if (
          (key === "DeployHoloFiLendingPoolWithMock#MockERC20" ||
            key === "MockERC20" ||
            key.includes("MockERC20") ||
            key.includes("mockAsset") ||
            key.includes("MockToken")) &&
          typeof addr === "string" &&
          ethers.isAddress(addr)
        ) {
          return ethers.getAddress(addr);
        }
      }
    } catch {}
  }

  throw new Error(
    "Could not resolve MockERC20 token address. Please provide it as a CLI argument, set MOCK_ERC20_ADDRESS in your environment, or deploy the mock token via Ignition."
  );
}

/**
 * Mint mock tokens to a recipient address and return balance difference and transaction details.
 */
export async function mintMockTokens(
  tokenContract: ethers.Contract | ethers.BaseContract | any,
  signer: ethers.Signer,
  recipientAddress: string,
  amountStr: string = "10000"
): Promise<MintResult> {
  const checksumRecipient = ethers.getAddress(recipientAddress);
  const tokenAddress = await tokenContract.getAddress();

  const [name, symbol, decimalsRaw] = await Promise.all([
    tokenContract.name().catch(() => "Mock Token"),
    tokenContract.symbol().catch(() => "MOCK"),
    tokenContract.decimals().catch(() => 18),
  ]);
  const decimals = Number(decimalsRaw);

  const parsedAmount = ethers.parseUnits(amountStr, decimals);
  const initialBalance = BigInt(await tokenContract.balanceOf(checksumRecipient));

  const connected = tokenContract.connect(signer) as ethers.Contract;
  const tx = (await connected.mint(checksumRecipient, parsedAmount)) as ethers.ContractTransactionResponse;
  const receipt = await tx.wait();

  const newBalance = BigInt(await tokenContract.balanceOf(checksumRecipient));

  return {
    recipientAddress: checksumRecipient,
    tokenAddress,
    tokenName: name,
    tokenSymbol: symbol,
    decimals,
    mintedAmount: parsedAmount,
    mintedFormatted: `${amountStr} ${symbol}`,
    initialBalance,
    initialBalanceFormatted: `${ethers.formatUnits(initialBalance, decimals)} ${symbol}`,
    newBalance,
    newBalanceFormatted: `${ethers.formatUnits(newBalance, decimals)} ${symbol}`,
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? 0,
  };
}

/**
 * Check mock token balance for a target address.
 */
export async function checkTokenBalance(
  tokenContract: ethers.Contract | ethers.BaseContract | any,
  targetAddress: string
): Promise<BalanceResult> {
  const checksumTarget = ethers.getAddress(targetAddress);
  const tokenAddress = await tokenContract.getAddress();

  const [name, symbol, decimalsRaw, balanceRaw] = await Promise.all([
    tokenContract.name().catch(() => "Mock Token"),
    tokenContract.symbol().catch(() => "MOCK"),
    tokenContract.decimals().catch(() => 18),
    tokenContract.balanceOf(checksumTarget),
  ]);
  const decimals = Number(decimalsRaw);
  const balance = BigInt(balanceRaw);

  return {
    targetAddress: checksumTarget,
    tokenAddress,
    tokenName: name,
    tokenSymbol: symbol,
    decimals,
    balance,
    balanceFormatted: `${ethers.formatUnits(balance, decimals)} ${symbol}`,
  };
}

/**
 * Format MintResult into an ASCII summary table string.
 */
export function formatMintResultTable(result: MintResult): string {
  const border = "=".repeat(80);
  const divider = "-".repeat(80);

  return [
    border,
    "                         MockERC20 Token Mint Summary                           ",
    border,
    `Recipient Address : ${result.recipientAddress}`,
    `Token Address     : ${result.tokenAddress} (${result.tokenName} - ${result.tokenSymbol})`,
    `Decimals          : ${result.decimals}`,
    divider,
    `Minted Amount     : +${result.mintedFormatted} (${result.mintedAmount.toString()} base units)`,
    `Initial Balance   : ${result.initialBalanceFormatted}`,
    `New Balance       : ${result.newBalanceFormatted}`,
    divider,
    `Transaction Hash  : ${result.txHash}`,
    `Block Number      : ${result.blockNumber}`,
    border,
  ].join("\n");
}

/**
 * Format BalanceResult into an ASCII summary table string.
 */
export function formatBalanceTable(result: BalanceResult): string {
  const border = "=".repeat(80);
  const divider = "-".repeat(80);

  return [
    border,
    "                         MockERC20 Token Balance                                ",
    border,
    `Target Address    : ${result.targetAddress}`,
    `Token Address     : ${result.tokenAddress} (${result.tokenName} - ${result.tokenSymbol})`,
    `Decimals          : ${result.decimals}`,
    divider,
    `Balance           : ${result.balanceFormatted} (${result.balance.toString()} base units)`,
    border,
  ].join("\n");
}

/**
 * Print detailed CLI usage and help guide.
 */
export function printHelp(): void {
  console.log(`
HoloFi Protocol - Mock ERC20 Token Minting & Balance CLI
============================================================

Mint test/mock ERC20 tokens (e.g. EURC) to any address or inspect balances.

Usage:
  npm run mint-mock-token -- [action] <recipient_address> [amount] [token_address] [options]
  # or
  npx tsx scripts/mint-mock-token.ts [action] <recipient_address> [amount] [token_address] [options]
  # or with Hardhat run:
  ACCOUNT=<recipient_address> [AMOUNT=<amount>] npx hardhat run scripts/mint-mock-token.ts --network <network>

Actions:
  mint (default)          Mint tokens to recipient address (default amount: 10000)
  balance | check         Check token balance for target address

Positional Arguments:
  <recipient_address>     Target wallet address (or 1st argument if action omitted)
  [amount]                Amount of tokens to mint (human formatted, e.g. 10000 or 50.5). Default: 10000
  [token_address]         Optional MockERC20 contract address (defaults to auto-detection)

Options:
  --token, -t <addr>      Specify MockERC20 contract address
  --amount, -a <amt>      Specify token amount to mint
  --network, -n <net>     Target network (e.g. localhost, baseSepolia, sepolia, mainnet). Default: localhost
  --help, -h              Show this help message

Environment Variables:
  RECIPIENT / ACCOUNT     Default recipient wallet address
  AMOUNT                  Default mint amount
  MOCK_ERC20_ADDRESS      Default MockERC20 contract address
  HARDHAT_NETWORK         Default network to connect to

Examples:
  npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 50000
  npm run mint-mock-token mint 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 2500
  npm run mint-mock-token balance 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  npm run mint-mock-token -- 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 10000 --network baseSepolia
  npx tsx scripts/mint-mock-token.ts 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 10000 --network baseSepolia
  npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --network sepolia
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

  if (!args.recipientAddress) {
    console.error("\n[ERROR] Missing required recipient or target address.");
    printHelp();
    process.exit(1);
  }

  if (!ethers.isAddress(args.recipientAddress)) {
    console.error(`\n[ERROR] Invalid address provided: "${args.recipientAddress}"`);
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
  const provider = hhEthers.provider;

  if (!provider) {
    throw new Error(
      `Unable to establish provider connection to network "${targetNetwork}".`
    );
  }

  const tokenAddress = await resolveMockTokenAddress(
    provider,
    args.tokenAddress,
    process.cwd(),
    targetNetwork
  );

  // Validate contract bytecode existence
  const code = await provider.getCode(tokenAddress);
  if (code === "0x" || code === "0x0") {
    throw new Error(
      `No contract bytecode deployed at MockERC20 address ${tokenAddress} on network "${targetNetwork}".\n` +
        `Please ensure that:\n` +
        `  1. Your local node is running (e.g. npx hardhat node)\n` +
        `  2. Contracts are deployed on "${targetNetwork}" (e.g. npx hardhat ignition deploy ignition/modules/DeployHoloFiLendingPoolWithMock.ts --network ${targetNetwork})\n` +
        `  3. You are pointing to the correct network (--network <network>) or address (--token <address>)`
    );
  }

  const tokenContract = new ethers.Contract(
    tokenAddress,
    MOCK_ERC20_ABI,
    signer || provider
  );

  const action = (args.action || "mint").toLowerCase();

  if (action === "balance" || action === "check" || action === "view" || action === "status") {
    const result = await checkTokenBalance(tokenContract, args.recipientAddress);
    console.log("\n" + formatBalanceTable(result) + "\n");
  } else if (action === "mint" || action === "add") {
    if (!signer) {
      console.error(
        `\n[ERROR] Signer is required to execute mint transaction on network "${targetNetwork}".`
      );
      process.exit(1);
    }
    const amountStr = args.amountStr || "10000";
    const result = await mintMockTokens(
      tokenContract,
      signer,
      args.recipientAddress,
      amountStr
    );
    console.log("\n" + formatMintResultTable(result) + "\n");
  } else {
    console.error(`\n[ERROR] Unknown action "${action}".`);
    printHelp();
    process.exit(1);
  }
}

// Auto-run if executed directly as CLI script
const isDirectScriptExecution =
  process.argv.some(
    (arg) => arg.includes("mint-mock-token.ts") || arg.includes("mint-mock-token.js")
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
