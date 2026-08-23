import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseCliArgs,
  resolveMockTokenAddress,
  mintMockTokens,
  checkTokenBalance,
  formatMintResultTable,
  formatBalanceTable,
  MOCK_ERC20_ABI,
  type MintResult,
  type BalanceResult,
  type ParsedCliArgs,
} from "../scripts/mint-mock-token.js";

const { ethers, networkHelpers } = await network.create();

describe("MintMockToken CLI Script Integration Tests", function () {
  async function deployMockTokenFixture() {
    const [owner, user, recipient] = await ethers.getSigners();
    const mockEurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const mockWeth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
    return { mockEurc, mockWeth, owner, user, recipient };
  }

  describe("ABI definitions and exports", function () {
    it("Should export valid MOCK_ERC20_ABI", function () {
      expect(MOCK_ERC20_ABI).to.be.an("array").that.is.not.empty;
      expect(MOCK_ERC20_ABI.some((sig) => sig.includes("mint("))).to.be.true;
      expect(MOCK_ERC20_ABI.some((sig) => sig.includes("balanceOf("))).to.be.true;
      expect(MOCK_ERC20_ABI.some((sig) => sig.includes("decimals("))).to.be.true;
      expect(MOCK_ERC20_ABI.some((sig) => sig.includes("name("))).to.be.true;
      expect(MOCK_ERC20_ABI.some((sig) => sig.includes("symbol("))).to.be.true;
    });
  });

  describe("parseCliArgs", function () {
    const sampleRecipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const sampleToken = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

    it("Should parse direct recipient address with default amount 10000", function () {
      const parsed = parseCliArgs(["node", "mint-mock-token.ts", sampleRecipient]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("10000");
      expect(parsed.tokenAddress).to.be.undefined;
    });

    it("Should parse recipient address with explicit amount and token address", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "5000",
        sampleToken,
      ]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("5000");
      expect(parsed.tokenAddress).to.equal(sampleToken);
    });

    it("Should parse recipient address with token address as 2nd positional if token is valid address", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        sampleToken,
      ]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.tokenAddress).to.equal(sampleToken);
      expect(parsed.amountStr).to.equal("10000");
    });

    it("Should parse 'mint' action with recipient and amount", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        "mint",
        sampleRecipient,
        "25000",
      ]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("25000");
    });

    it("Should parse 'mint' action with recipient, amount, and token address", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        "mint",
        sampleRecipient,
        "25000",
        sampleToken,
      ]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("25000");
      expect(parsed.tokenAddress).to.equal(sampleToken);
    });

    it("Should parse positional non-standard action with recipient and amount", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        "customAction",
        sampleRecipient,
        "1234",
        sampleToken,
      ]);
      expect(parsed.action).to.equal("customAction");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("1234");
      expect(parsed.tokenAddress).to.equal(sampleToken);
    });

    it("Should parse 'add' alias for mint action", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        "add",
        sampleRecipient,
        "100",
      ]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("100");
    });

    it("Should parse 'balance' action with target address", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        "balance",
        sampleRecipient,
      ]);
      expect(parsed.action).to.equal("balance");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
    });

    it("Should parse 'check', 'status', and 'view' aliases for balance action", function () {
      const p1 = parseCliArgs(["node", "mint-mock-token.ts", "check", sampleRecipient]);
      expect(p1.action).to.equal("balance");
      expect(p1.recipientAddress).to.equal(sampleRecipient);

      const p2 = parseCliArgs(["node", "mint-mock-token.ts", "status", sampleRecipient]);
      expect(p2.action).to.equal("balance");
      expect(p2.recipientAddress).to.equal(sampleRecipient);

      const p3 = parseCliArgs(["node", "mint-mock-token.ts", "view", sampleRecipient]);
      expect(p3.action).to.equal("balance");
      expect(p3.recipientAddress).to.equal(sampleRecipient);
    });

    it("Should parse 'balance' action with optional token address", function () {
      const parsed = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        "balance",
        sampleRecipient,
        sampleToken,
      ]);
      expect(parsed.action).to.equal("balance");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.tokenAddress).to.equal(sampleToken);
    });

    it("Should parse --token, -t, --contract, and -c flags", function () {
      const p1 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "--token",
        sampleToken,
      ]);
      expect(p1.tokenAddress).to.equal(sampleToken);

      const p2 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        `-t`,
        sampleToken,
      ]);
      expect(p2.tokenAddress).to.equal(sampleToken);

      const p3 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        `--token=${sampleToken}`,
      ]);
      expect(p3.tokenAddress).to.equal(sampleToken);

      const p4 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        `--contract`,
        sampleToken,
      ]);
      expect(p4.tokenAddress).to.equal(sampleToken);

      const p5 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        `-c`,
        sampleToken,
      ]);
      expect(p5.tokenAddress).to.equal(sampleToken);
    });

    it("Should parse --amount and -a flags", function () {
      const p1 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "--amount",
        "7777",
      ]);
      expect(p1.amountStr).to.equal("7777");

      const p2 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "-a",
        "8888",
      ]);
      expect(p2.amountStr).to.equal("8888");

      const p3 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "--amount=9999",
      ]);
      expect(p3.amountStr).to.equal("9999");
    });

    it("Should parse --network and -n flags", function () {
      const p1 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "--network",
        "sepolia",
      ]);
      expect(p1.networkName).to.equal("sepolia");

      const p2 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "-n",
        "baseSepolia",
      ]);
      expect(p2.networkName).to.equal("baseSepolia");

      const p3 = parseCliArgs([
        "node",
        "mint-mock-token.ts",
        sampleRecipient,
        "--network=mainnet",
      ]);
      expect(p3.networkName).to.equal("mainnet");
    });

    it("Should parse arguments after double dash '--'", function () {
      const parsed = parseCliArgs([
        "node",
        "hardhat",
        "run",
        "scripts/mint-mock-token.ts",
        "--network",
        "localhost",
        "--",
        sampleRecipient,
        "12345",
        "--token",
        sampleToken,
      ]);
      expect(parsed.action).to.equal("mint");
      expect(parsed.recipientAddress).to.equal(sampleRecipient);
      expect(parsed.amountStr).to.equal("12345");
      expect(parsed.tokenAddress).to.equal(sampleToken);
    });

    it("Should parse --help, -h, and help flags", function () {
      expect(parseCliArgs(["node", "mint-mock-token.ts", "--help"]).help).to.be.true;
      expect(parseCliArgs(["node", "mint-mock-token.ts", "-h"]).help).to.be.true;
      expect(parseCliArgs(["node", "mint-mock-token.ts", "help"]).help).to.be.true;
    });

    it("Should parse environment variables when CLI arguments are omitted", function () {
      process.env.RECIPIENT = sampleRecipient;
      process.env.AMOUNT = "50000";
      process.env.MOCK_ERC20_ADDRESS = sampleToken;
      process.env.HARDHAT_NETWORK = "sepolia";
      process.env.ACTION = "mint";

      try {
        const parsed = parseCliArgs(["node", "mint-mock-token.ts"]);
        expect(parsed.action).to.equal("mint");
        expect(parsed.recipientAddress).to.equal(sampleRecipient);
        expect(parsed.amountStr).to.equal("50000");
        expect(parsed.tokenAddress).to.equal(sampleToken);
        expect(parsed.networkName).to.equal("sepolia");
      } finally {
        delete process.env.RECIPIENT;
        delete process.env.AMOUNT;
        delete process.env.MOCK_ERC20_ADDRESS;
        delete process.env.HARDHAT_NETWORK;
        delete process.env.ACTION;
      }
    });

    it("Should parse alternative environment variable names (ACCOUNT, TARGET_ADDRESS, TOKEN_ADDRESS)", function () {
      process.env.ACCOUNT = sampleRecipient;
      process.env.TOKEN_ADDRESS = sampleToken;

      try {
        const parsed = parseCliArgs(["node", "mint-mock-token.ts"]);
        expect(parsed.recipientAddress).to.equal(sampleRecipient);
        expect(parsed.tokenAddress).to.equal(sampleToken);
        expect(parsed.amountStr).to.equal("10000");
      } finally {
        delete process.env.ACCOUNT;
        delete process.env.TOKEN_ADDRESS;
      }
    });
  });

  describe("resolveMockTokenAddress", function () {
    const sampleToken = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

    it("Should prioritize CLI address argument when valid", async function () {
      const resolved = await resolveMockTokenAddress(ethers.provider, sampleToken);
      expect(resolved).to.equal(sampleToken);
    });

    it("Should resolve from MOCK_ERC20_ADDRESS environment variable", async function () {
      process.env.MOCK_ERC20_ADDRESS = sampleToken;
      try {
        const resolved = await resolveMockTokenAddress(ethers.provider);
        expect(resolved).to.equal(sampleToken);
      } finally {
        delete process.env.MOCK_ERC20_ADDRESS;
      }
    });

    it("Should resolve from TOKEN_ADDRESS environment variable", async function () {
      process.env.TOKEN_ADDRESS = sampleToken;
      try {
        const resolved = await resolveMockTokenAddress(ethers.provider);
        expect(resolved).to.equal(sampleToken);
      } finally {
        delete process.env.TOKEN_ADDRESS;
      }
    });

    it("Should resolve from MOCK_TOKEN_ADDRESS environment variable", async function () {
      process.env.MOCK_TOKEN_ADDRESS = sampleToken;
      try {
        const resolved = await resolveMockTokenAddress(ethers.provider);
        expect(resolved).to.equal(sampleToken);
      } finally {
        delete process.env.MOCK_TOKEN_ADDRESS;
      }
    });

    it("Should resolve from CONTRACT_ADDRESS environment variable", async function () {
      process.env.CONTRACT_ADDRESS = sampleToken;
      try {
        const resolved = await resolveMockTokenAddress(ethers.provider);
        expect(resolved).to.equal(sampleToken);
      } finally {
        delete process.env.CONTRACT_ADDRESS;
      }
    });

    it("Should resolve address from chain-specific Ignition deployed_addresses.json", async function () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holofi-mock-test-"));
      try {
        const networkInfo = await ethers.provider.getNetwork();
        const chainId = networkInfo.chainId.toString();
        const chainDir = path.join(tempDir, "ignition", "deployments", `chain-${chainId}`);
        fs.mkdirSync(chainDir, { recursive: true });

        const deployedData = {
          "DeployHoloFiLendingPoolWithMock#MockERC20": sampleToken,
        };
        fs.writeFileSync(
          path.join(chainDir, "deployed_addresses.json"),
          JSON.stringify(deployedData)
        );

        const resolved = await resolveMockTokenAddress(ethers.provider, undefined, tempDir);
        expect(resolved).to.equal(sampleToken);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Should resolve address from any ignition deployment subfolder", async function () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holofi-mock-test-"));
      try {
        const subDir = path.join(tempDir, "ignition", "deployments", "custom-network-999");
        fs.mkdirSync(subDir, { recursive: true });

        const deployedData = {
          "mockAsset": sampleToken,
        };
        fs.writeFileSync(
          path.join(subDir, "deployed_addresses.json"),
          JSON.stringify(deployedData)
        );

        const resolved = await resolveMockTokenAddress(ethers.provider, undefined, tempDir);
        expect(resolved).to.equal(sampleToken);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Should resolve address from root deployed_addresses.json", async function () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holofi-mock-test-"));
      try {
        const deployedData = {
          "MockERC20": sampleToken,
        };
        fs.writeFileSync(
          path.join(tempDir, "deployed_addresses.json"),
          JSON.stringify(deployedData)
        );

        const resolved = await resolveMockTokenAddress(ethers.provider, undefined, tempDir);
        expect(resolved).to.equal(sampleToken);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Should resolve from networkName mapping (e.g. baseSepolia) even if provider fails", async function () {
      const failingProvider = {
        getNetwork: async () => {
          throw new Error("RPC unreachable");
        },
      } as any;

      const resolved = await resolveMockTokenAddress(
        failingProvider,
        undefined,
        process.cwd(),
        "baseSepolia"
      );
      expect(resolved).to.equal("0xa59c4194a02f5EDfCE72b567aeB5B7Df252961CF");
    });

    it("Should throw descriptive error if address cannot be resolved", async function () {
      const saved1 = process.env.MOCK_ERC20_ADDRESS;
      const saved2 = process.env.TOKEN_ADDRESS;
      const saved3 = process.env.MOCK_TOKEN_ADDRESS;
      const saved4 = process.env.CONTRACT_ADDRESS;

      delete process.env.MOCK_ERC20_ADDRESS;
      delete process.env.TOKEN_ADDRESS;
      delete process.env.MOCK_TOKEN_ADDRESS;
      delete process.env.CONTRACT_ADDRESS;

      try {
        let threw = false;
        try {
          await resolveMockTokenAddress(ethers.provider, undefined, "/non/existent/dir");
        } catch (err: any) {
          threw = true;
          expect(err.message).to.include("Could not resolve MockERC20 token address");
        }
        expect(threw, "Expected resolveMockTokenAddress to throw").to.be.true;
      } finally {
        if (saved1) process.env.MOCK_ERC20_ADDRESS = saved1;
        if (saved2) process.env.TOKEN_ADDRESS = saved2;
        if (saved3) process.env.MOCK_TOKEN_ADDRESS = saved3;
        if (saved4) process.env.CONTRACT_ADDRESS = saved4;
      }
    });
  });

  describe("mintMockTokens integration", function () {
    it("Should mint default 10,000 tokens to user address with 6 decimals (EURC)", async function () {
      const { mockEurc, owner, user } = await networkHelpers.loadFixture(deployMockTokenFixture);

      const result: MintResult = await mintMockTokens(
        mockEurc,
        owner,
        user.address,
        "10000"
      );

      const expectedDecimals = 6;
      const expectedAmount = 10_000n * 10n ** BigInt(expectedDecimals);

      expect(result.recipientAddress).to.equal(user.address);
      expect(result.tokenAddress).to.equal(await mockEurc.getAddress());
      expect(result.tokenName).to.equal("Euro Coin");
      expect(result.tokenSymbol).to.equal("EURC");
      expect(result.decimals).to.equal(expectedDecimals);
      expect(result.mintedAmount).to.equal(expectedAmount);
      expect(result.mintedFormatted).to.equal("10000 EURC");
      expect(result.initialBalance).to.equal(0n);
      expect(result.initialBalanceFormatted).to.equal("0.0 EURC");
      expect(result.newBalance).to.equal(expectedAmount);
      expect(result.newBalanceFormatted).to.equal("10000.0 EURC");
      expect(result.txHash).to.match(/^0x[a-fA-F0-9]{64}$/);
      expect(result.blockNumber).to.be.greaterThan(0);

      // Verify on-chain balance matches
      const onChainBalance = await mockEurc.balanceOf(user.address);
      expect(onChainBalance).to.equal(expectedAmount);
    });

    it("Should mint additional custom fractional amount and update balances correctly", async function () {
      const { mockEurc, owner, user } = await networkHelpers.loadFixture(deployMockTokenFixture);

      // First mint 1000 EURC
      await mintMockTokens(mockEurc, owner, user.address, "1000");

      // Mint additional 5000.5 EURC
      const result = await mintMockTokens(mockEurc, owner, user.address, "5000.5");

      const expectedInitial = 1000n * 10n ** 6n;
      const expectedAdditional = 5000500000n; // 5000.5 * 10^6
      const expectedTotal = expectedInitial + expectedAdditional;

      expect(result.initialBalance).to.equal(expectedInitial);
      expect(result.mintedAmount).to.equal(expectedAdditional);
      expect(result.newBalance).to.equal(expectedTotal);
      expect(result.mintedFormatted).to.equal("5000.5 EURC");

      const onChainBalance = await mockEurc.balanceOf(user.address);
      expect(onChainBalance).to.equal(expectedTotal);
    });

    it("Should handle 18 decimal tokens correctly (WETH)", async function () {
      const { mockWeth, owner, recipient } = await networkHelpers.loadFixture(deployMockTokenFixture);

      const result = await mintMockTokens(
        mockWeth,
        owner,
        recipient.address,
        "2.5"
      );

      const expectedAmount = ethersLib.parseUnits("2.5", 18);

      expect(result.tokenName).to.equal("Wrapped Ether");
      expect(result.tokenSymbol).to.equal("WETH");
      expect(result.decimals).to.equal(18);
      expect(result.mintedAmount).to.equal(expectedAmount);
      expect(result.newBalance).to.equal(expectedAmount);

      const onChainBalance = await mockWeth.balanceOf(recipient.address);
      expect(onChainBalance).to.equal(expectedAmount);
    });

    it("Should throw an error when an invalid amount string is provided", async function () {
      const { mockEurc, owner, user } = await networkHelpers.loadFixture(deployMockTokenFixture);

      let threw = false;
      try {
        await mintMockTokens(mockEurc, owner, user.address, "invalid-amount");
      } catch {
        threw = true;
      }
      expect(threw, "Expected mintMockTokens to throw on invalid amount").to.be.true;
    });
  });

  describe("checkTokenBalance integration", function () {
    it("Should query user balance and return formatted BalanceResult", async function () {
      const { mockEurc, owner, user } = await networkHelpers.loadFixture(deployMockTokenFixture);

      // Query initial balance (0)
      const initialRes: BalanceResult = await checkTokenBalance(mockEurc, user.address);
      expect(initialRes.targetAddress).to.equal(user.address);
      expect(initialRes.tokenAddress).to.equal(await mockEurc.getAddress());
      expect(initialRes.tokenName).to.equal("Euro Coin");
      expect(initialRes.tokenSymbol).to.equal("EURC");
      expect(initialRes.decimals).to.equal(6);
      expect(initialRes.balance).to.equal(0n);
      expect(initialRes.balanceFormatted).to.equal("0.0 EURC");

      // Mint tokens
      await mintMockTokens(mockEurc, owner, user.address, "15000");

      // Query balance after mint
      const postMintRes: BalanceResult = await checkTokenBalance(mockEurc, user.address);
      const expectedBalance = 15000n * 10n ** 6n;
      expect(postMintRes.balance).to.equal(expectedBalance);
      expect(postMintRes.balanceFormatted).to.equal("15000.0 EURC");
    });
  });

  describe("Table Formatters", function () {
    it("Should format MintResult into summary table string", function () {
      const sampleResult: MintResult = {
        recipientAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        tokenName: "Euro Coin",
        tokenSymbol: "EURC",
        decimals: 6,
        mintedAmount: 10000000000n,
        mintedFormatted: "10000 EURC",
        initialBalance: 0n,
        initialBalanceFormatted: "0.0 EURC",
        newBalance: 10000000000n,
        newBalanceFormatted: "10000.0 EURC",
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        blockNumber: 42,
      };

      const table = formatMintResultTable(sampleResult);

      expect(table).to.include("MockERC20 Token Mint Summary");
      expect(table).to.include("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      expect(table).to.include("0x5FbDB2315678afecb367f032d93F642f64180aa3");
      expect(table).to.include("Euro Coin - EURC");
      expect(table).to.include("Decimals          : 6");
      expect(table).to.include("Minted Amount     : +10000 EURC (10000000000 base units)");
      expect(table).to.include("Initial Balance   : 0.0 EURC");
      expect(table).to.include("New Balance       : 10000.0 EURC");
      expect(table).to.include("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      expect(table).to.include("Block Number      : 42");
    });

    it("Should format BalanceResult into summary table string", function () {
      const sampleResult: BalanceResult = {
        targetAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        tokenName: "Euro Coin",
        tokenSymbol: "EURC",
        decimals: 6,
        balance: 25000000000n,
        balanceFormatted: "25000.0 EURC",
      };

      const table = formatBalanceTable(sampleResult);

      expect(table).to.include("MockERC20 Token Balance");
      expect(table).to.include("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      expect(table).to.include("0x5FbDB2315678afecb367f032d93F642f64180aa3");
      expect(table).to.include("Euro Coin - EURC");
      expect(table).to.include("Decimals          : 6");
      expect(table).to.include("Balance           : 25000.0 EURC (25000000000 base units)");
    });
  });
});
