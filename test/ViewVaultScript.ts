import { expect } from "chai";
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";
import {
  parseCliArgs,
  resolveLoanCoreAddress,
  fetchVaultDetails,
  formatVaultDetailsTable,
  LOAN_CORE_ABI,
  LENDING_POOL_ABI,
  POLICY_ABI,
  VAULT_CARD_ABI,
  PRICE_FEED_ABI,
  ACM_ABI,
} from "../scripts/view-vault.js";

const { ethers } = await network.create();

describe("ViewVault CLI Script Integration Tests", function () {
  describe("ABI definitions and exports", function () {
    it("Should export valid LOAN_CORE_ABI", function () {
      expect(LOAN_CORE_ABI).to.be.an("array").that.is.not.empty;
      expect(LOAN_CORE_ABI.some((entry) => entry.includes("getVault"))).to.be.true;
      expect(LOAN_CORE_ABI.some((entry) => entry.includes("getVaultFMV"))).to.be.true;
      expect(LOAN_CORE_ABI.some((entry) => entry.includes("getMaxBorrowCapacity"))).to.be.true;
      expect(LOAN_CORE_ABI.some((entry) => entry.includes("getTotalDebt"))).to.be.true;
      expect(LOAN_CORE_ABI.some((entry) => entry.includes("getHealthFactor"))).to.be.true;
    });

    it("Should export valid LENDING_POOL_ABI", function () {
      expect(LENDING_POOL_ABI).to.be.an("array").that.is.not.empty;
      expect(LENDING_POOL_ABI.some((entry) => entry.includes("maxLtvBps"))).to.be.true;
      expect(LENDING_POOL_ABI.some((entry) => entry.includes("eligibilityPolicy"))).to.be.true;
    });

    it("Should export valid POLICY_ABI and VAULT_CARD_ABI", function () {
      expect(POLICY_ABI).to.be.an("array").that.is.not.empty;
      expect(POLICY_ABI.some((entry) => entry.includes("requiredGrader"))).to.be.true;
      expect(VAULT_CARD_ABI).to.be.an("array").that.is.not.empty;
      expect(VAULT_CARD_ABI.some((entry) => entry.includes("getCard"))).to.be.true;
      expect(PRICE_FEED_ABI).to.be.an("array").that.is.not.empty;
      expect(ACM_ABI).to.be.an("array").that.is.not.empty;
    });
  });

  describe("parseCliArgs", function () {
    it("Should parse numeric vault ID as first positional argument", function () {
      const args = parseCliArgs(["node", "view-vault.ts", "1"]);
      expect(args.vaultId).to.equal(1n);
      expect(args.loanCoreAddress).to.be.undefined;
      expect(args.help).to.be.undefined;
    });

    it("Should parse vault ID and contract address positional arguments", function () {
      const targetAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const args = parseCliArgs(["node", "view-vault.ts", "42", targetAddr]);
      expect(args.vaultId).to.equal(42n);
      expect(args.loanCoreAddress).to.equal(targetAddr);
    });

    it("Should parse when contract address is first and vault ID is second", function () {
      const targetAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const args = parseCliArgs(["node", "view-vault.ts", targetAddr, "5"]);
      expect(args.vaultId).to.equal(5n);
      expect(args.loanCoreAddress).to.equal(targetAddr);
    });

    it("Should parse --loan-core, --loancore, and -l flags", function () {
      const targetAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const args1 = parseCliArgs(["node", "view-vault.ts", "1", "--loan-core", targetAddr]);
      expect(args1.loanCoreAddress).to.equal(targetAddr);

      const args2 = parseCliArgs(["node", "view-vault.ts", "1", "-l", targetAddr]);
      expect(args2.loanCoreAddress).to.equal(targetAddr);

      const args3 = parseCliArgs(["node", "view-vault.ts", "1", `--loan-core=${targetAddr}`]);
      expect(args3.loanCoreAddress).to.equal(targetAddr);
    });

    it("Should parse --network and -n flags", function () {
      const args1 = parseCliArgs(["node", "view-vault.ts", "1", "--network", "sepolia"]);
      expect(args1.networkName).to.equal("sepolia");

      const args2 = parseCliArgs(["node", "view-vault.ts", "1", "-n", "mainnet"]);
      expect(args2.networkName).to.equal("mainnet");

      const args3 = parseCliArgs(["node", "view-vault.ts", "1", "--network=polygon"]);
      expect(args3.networkName).to.equal("polygon");
    });

    it("Should parse arguments after double dash '--'", function () {
      const targetAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const args = parseCliArgs(["node", "view-vault.ts", "--", "7", targetAddr, "--network", "sepolia"]);
      expect(args.vaultId).to.equal(7n);
      expect(args.loanCoreAddress).to.equal(targetAddr);
      expect(args.networkName).to.equal("sepolia");
    });

    it("Should parse --help, -h, and help flags", function () {
      expect(parseCliArgs(["node", "view-vault.ts", "--help"]).help).to.be.true;
      expect(parseCliArgs(["node", "view-vault.ts", "-h"]).help).to.be.true;
      expect(parseCliArgs(["node", "view-vault.ts", "help"]).help).to.be.true;
    });

    it("Should parse environment variables when CLI args are absent", function () {
      const origVaultId = process.env.VAULT_ID;
      const origLoanCore = process.env.LOAN_CORE_ADDRESS;
      const origNetwork = process.env.HARDHAT_NETWORK;

      try {
        process.env.VAULT_ID = "99";
        process.env.LOAN_CORE_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        process.env.HARDHAT_NETWORK = "localhost";

        const args = parseCliArgs(["node", "view-vault.ts"]);
        expect(args.vaultId).to.equal(99n);
        expect(args.loanCoreAddress).to.equal("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        expect(args.networkName).to.equal("localhost");
      } finally {
        if (origVaultId !== undefined) process.env.VAULT_ID = origVaultId;
        else delete process.env.VAULT_ID;

        if (origLoanCore !== undefined) process.env.LOAN_CORE_ADDRESS = origLoanCore;
        else delete process.env.LOAN_CORE_ADDRESS;

        if (origNetwork !== undefined) process.env.HARDHAT_NETWORK = origNetwork;
        else delete process.env.HARDHAT_NETWORK;
      }
    });
  });

  describe("resolveLoanCoreAddress", function () {
    it("Should prioritize CLI address when valid", async function () {
      const cliAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const resolved = await resolveLoanCoreAddress(ethers.provider, process.cwd(), cliAddr);
      expect(resolved).to.equal(ethersLib.getAddress(cliAddr));
    });

    it("Should resolve from LOAN_CORE_ADDRESS environment variable", async function () {
      const origEnv = process.env.LOAN_CORE_ADDRESS;
      const testAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      try {
        process.env.LOAN_CORE_ADDRESS = testAddr;
        const resolved = await resolveLoanCoreAddress(ethers.provider, process.cwd());
        expect(resolved).to.equal(ethersLib.getAddress(testAddr));
      } finally {
        if (origEnv !== undefined) process.env.LOAN_CORE_ADDRESS = origEnv;
        else delete process.env.LOAN_CORE_ADDRESS;
      }
    });

    it("Should throw error if address cannot be resolved", async function () {
      const origEnv1 = process.env.LOAN_CORE_ADDRESS;
      const origEnv2 = process.env.VAULT_LOAN_CORE_ADDRESS;
      const origEnv3 = process.env.CONTRACT_ADDRESS;

      try {
        delete process.env.LOAN_CORE_ADDRESS;
        delete process.env.VAULT_LOAN_CORE_ADDRESS;
        delete process.env.CONTRACT_ADDRESS;

        let error: any;
        try {
          await resolveLoanCoreAddress(ethers.provider, "/non/existent/path");
        } catch (err) {
          error = err;
        }
        expect(error).to.not.be.undefined;
        expect(error.message).to.include("Could not resolve HoloFiVaultLoanCore contract address");
      } finally {
        if (origEnv1) process.env.LOAN_CORE_ADDRESS = origEnv1;
        if (origEnv2) process.env.VAULT_LOAN_CORE_ADDRESS = origEnv2;
        if (origEnv3) process.env.CONTRACT_ADDRESS = origEnv3;
      }
    });
  });

  describe("fetchVaultDetails integration", function () {
    async function deployFixture() {
      const [admin, oracle, minter, store, lpUser, treasury] = await ethers.getSigners();

      // 1. Deploy ACM
      const ACM = await ethers.getContractFactory("AccessControlManager");
      const acm = await ACM.deploy(admin.address);
      await acm.waitForDeployment();

      // 2. Deploy VaultCard
      const VaultCard = await ethers.getContractFactory("HoloFiVaultCard");
      const vaultCard = await VaultCard.deploy("HoloFi Vaulted Cards", "HFC", await acm.getAddress());
      await vaultCard.waitForDeployment();

      // 3. Deploy PriceFeed
      const PriceFeed = await ethers.getContractFactory("HoloFiCardPriceFeed");
      const priceFeed = await PriceFeed.deploy(await acm.getAddress());
      await priceFeed.waitForDeployment();

      // 4. Deploy PoolFactory
      const PoolFactory = await ethers.getContractFactory("HoloFiLendingPoolFactory");
      const poolFactory = await PoolFactory.deploy(await acm.getAddress());
      await poolFactory.waitForDeployment();

      // 5. Deploy LoanCore
      const LoanCore = await ethers.getContractFactory("HoloFiVaultLoanCore");
      const loanCore = await LoanCore.deploy(
        await acm.getAddress(),
        await vaultCard.getAddress(),
        await poolFactory.getAddress(),
        await priceFeed.getAddress()
      );
      await loanCore.waitForDeployment();

      // 6. Deploy Mock Asset (EURC with 6 decimals)
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const mockAsset = await MockERC20.deploy("Euro Coin", "EURC", 6);
      await mockAsset.waitForDeployment();

      // 7. Deploy Policy (PSA 10)
      const Policy = await ethers.getContractFactory("GradeEligibilityPolicy");
      const policy = await Policy.deploy(await acm.getAddress(), "PSA", 10n, 10n);
      await policy.waitForDeployment();

      // 8. Create Premium Pool EURC (50% LTV, 70% LT, 10% Penalty, 5% APY)
      await (poolFactory as any).connect(admin).createPool(
        await mockAsset.getAddress(),
        "Premium Pool EURC",
        "pEURC",
        5000n,
        7000n,
        1000n,
        500n
      );
      const poolAddress = await (poolFactory as any).allPools(0);
      const pool = await ethers.getContractAt("HoloFiLendingPool", poolAddress);
      await pool.connect(admin).setLoanCore(await loanCore.getAddress());
      await pool.connect(admin).setEligibilityPolicy(await policy.getAddress());

      // 9. Grant Roles
      const ADMIN_ROLE = await acm.ADMIN_ROLE();
      const ORACLE_ROLE = await acm.ORACLE_ROLE();
      const MINTER_ROLE = await acm.MINTER_ROLE();
      await acm.connect(admin).grantRole(ADMIN_ROLE, await loanCore.getAddress());
      await acm.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
      await acm.connect(admin).grantRole(MINTER_ROLE, minter.address);
      await acm.connect(admin).setKybStatus(store.address, true);

      // Seed liquidity in pool (100,000 EURC)
      const seedAmount = 100_000n * 10n ** 6n;
      await mockAsset.connect(admin).mint(admin.address, seedAmount);
      await mockAsset.connect(admin).approve(poolAddress, seedAmount);
      await pool.connect(admin).deposit(seedAmount, "0x000000000000000000000000000000000000dEaD");

      // 10. Register card type in policy and set oracle price (2,000 EUR each)
      const cardAttrs = {
        game: "Pokemon",
        language: "EN",
        setName: "Base Set",
        cardName: "Charizard",
        cardNumber: "4/102",
        printing: "1st Edition",
        grader: "PSA",
        grade: "10",
      };
      await (policy as any).connect(minter).registerCardType(cardAttrs);
      const cardTypeId = await (policy as any).computeCardTypeId(cardAttrs);
      const cardFmvPrice = 2000n * 10n ** 18n; // 2,000 EUR (18 decimals)
      await priceFeed.connect(oracle).setPrice(cardTypeId, cardFmvPrice);

      // 11. Mint 2 Cards to store
      const attestationHash1 = ethers.keccak256(ethers.toUtf8Bytes("attestation_1"));
      const attestationHash2 = ethers.keccak256(ethers.toUtf8Bytes("attestation_2"));
      await (vaultCard as any).connect(minter).mintCard(store.address, cardTypeId, attestationHash1, "ipfs://card1");
      await (vaultCard as any).connect(minter).mintCard(store.address, cardTypeId, attestationHash2, "ipfs://card2");

      return {
        acm,
        vaultCard,
        priceFeed,
        poolFactory,
        loanCore,
        mockAsset,
        policy,
        pool,
        admin,
        oracle,
        minter,
        store,
        cardTypeId,
        cardFmvPrice,
      };
    }

    it("Should fetch full details for an active vault with deposited cards and active borrow", async function () {
      const fixture = await deployFixture();
      const { loanCore, vaultCard, pool, store } = fixture;

      // Store creates Vault #1 connected to pool
      await (loanCore as any).connect(store).createVault(await pool.getAddress());

      // Approve and deposit 2 cards
      await (vaultCard as any).connect(store).setApprovalForAll(await loanCore.getAddress(), true);
      await (loanCore as any).connect(store).depositCollateral(1n, [1n, 2n]);

      // Borrow 1,000 EURC (1000 * 10^6)
      const borrowAmount = 1000n * 10n ** 6n;
      await (loanCore as any).connect(store).borrow(1n, borrowAmount);

      const details = await fetchVaultDetails(ethers.provider, loanCore as any, 1n);

      // Assert basic vault properties
      expect(details.vaultId).to.equal(1n);
      expect(details.status).to.equal(0);
      expect(details.statusLabel).to.include("ACTIVE");
      expect(details.owner).to.equal(store.address);
      expect(details.isOwnerKybApproved).to.be.true;
      expect(details.tokenIds).to.deep.equal([1n, 2n]);

      // Assert lending pool & policy details
      expect(details.lendingPoolDetails).to.not.be.undefined;
      expect(details.lendingPoolDetails!.poolName).to.equal("Premium Pool EURC");
      expect(details.lendingPoolDetails!.poolSymbol).to.equal("pEURC");
      expect(details.lendingPoolDetails!.assetSymbol).to.equal("EURC");
      expect(details.lendingPoolDetails!.assetDecimals).to.equal(6);
      expect(details.lendingPoolDetails!.maxLtvPercent).to.equal("50.00%");
      expect(details.lendingPoolDetails!.eligibilityPolicyLabel).to.include("PSA Grade 10");

      // Assert collateral cards summary
      expect(details.collateralCards).to.have.length(2);
      expect(details.collateralCards[0].tokenId).to.equal(1n);
      expect(details.collateralCards[0].tokenURI).to.equal("ipfs://card1");
      expect(details.collateralCards[0].priceFormatted).to.include("2,000.00 EUR");
      expect(details.collateralCards[1].tokenId).to.equal(2n);
      expect(details.collateralCards[1].tokenURI).to.equal("ipfs://card2");

      // Assert financial calculations: 2 cards * 2,000 = 4,000 EUR total FMV (18 decimals = 4000 * 10^18)
      expect(details.totalCollateralFmvRaw).to.equal(4000n * 10n ** 18n);
      expect(details.totalCollateralFmvFormatted).to.include("4,000.00 EUR");

      // Max Borrow Capacity = 50% of 4,000 = 2,000 EURC
      expect(details.maxBorrowCapacityRaw).to.equal(2000n * 10n ** 6n);
      expect(details.maxBorrowCapacityFormatted).to.include("2,000.00 EURC");

      // Principal Debt = 1,000 EURC
      expect(details.principalDebtRaw).to.equal(1000n * 10n ** 6n);
      expect(details.principalDebtFormatted).to.include("1,000.00 EURC");

      // Remaining Borrow = 1,000 EURC
      expect(details.remainingBorrowCapacityRaw).to.equal(1000n * 10n ** 6n);
      expect(details.remainingBorrowCapacityFormatted).to.include("1,000.00 EURC");

      // Health status and LTV: 1,000 debt / 4,000 collateral = 25.00%
      expect(details.currentLtvPercent).to.equal("25.00%");
      expect(details.healthStatus).to.equal("HEALTHY");
      expect(details.healthFactorFormatted).to.include("HEALTHY");
    });

    it("Should fetch details for a fresh empty vault without active debt", async function () {
      const fixture = await deployFixture();
      const { loanCore, pool, store } = fixture;

      // Store creates Vault #1 without depositing cards yet
      await (loanCore as any).connect(store).createVault(await pool.getAddress());

      const details = await fetchVaultDetails(ethers.provider, loanCore as any, 1n);

      expect(details.vaultId).to.equal(1n);
      expect(details.tokenIds).to.be.empty;
      expect(details.collateralCards).to.be.empty;
      expect(details.totalCollateralFmvRaw).to.equal(0n);
      expect(details.principalDebtRaw).to.equal(0n);
      expect(details.totalDebtRaw).to.equal(0n);
      expect(details.healthStatus).to.equal("NO_DEBT");
      expect(details.healthFactorFormatted).to.include("No Active Debt");
    });

    it("Should throw error when querying a non-existent or uninitialized vault ID", async function () {
      const fixture = await deployFixture();
      const { loanCore } = fixture;

      let error: any;
      try {
        await fetchVaultDetails(ethers.provider, loanCore as any, 999n);
      } catch (err) {
        error = err;
      }
      expect(error).to.not.be.undefined;
      expect(error.message).to.include("Vault #999 does not exist or is uninitialized.");
    });
  });

  describe("formatVaultDetailsTable", function () {
    it("Should format complete VaultDetails into clean ASCII summary table", function () {
      const sampleDetails = {
        vaultId: 1n,
        loanCoreAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        status: 0,
        statusLabel: "ACTIVE [Borrowing & Collateral Active]",
        owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        isOwnerKybApproved: true,
        lastInterestUpdateTime: 1770000000n,
        lastInterestUpdateDate: "2026-08-21T18:00:00.000Z",
        lendingPoolAddress: "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81",
        lendingPoolDetails: {
          poolAddress: "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81",
          poolName: "Premium Pool EURC",
          poolSymbol: "pEURC",
          assetAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
          assetName: "Euro Coin",
          assetSymbol: "EURC",
          assetDecimals: 6,
          maxLtvBps: 5000n,
          maxLtvPercent: "50.00%",
          liquidationThresholdBps: 7000n,
          liquidationThresholdPercent: "70.00%",
          liquidationPenaltyBps: 1000n,
          liquidationPenaltyPercent: "10.00%",
          borrowRateBpsPerYear: 500n,
          borrowRatePercent: "5.00%",
          eligibilityPolicyAddress: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
          eligibilityPolicyLabel: "GradeEligibilityPolicy (PSA Grade 10) [0x0165878A...]",
        },
        tokenIds: [1n, 2n],
        collateralCards: [
          {
            tokenId: 1n,
            cardTypeId: "0x1234...5678",
            attestationHash: "0xabcd...ef01",
            mintTimestamp: 1770000000n,
            mintDate: "2026-08-21T18:00:00.000Z",
            isLocked: true,
            tokenURI: "ipfs://card1",
            priceRaw: 2000n * 10n ** 18n,
            priceFormatted: "2,000.00 EUR",
          },
        ],
        totalCollateralFmvRaw: 4000n * 10n ** 18n,
        totalCollateralFmvFormatted: "4,000.00 EUR",
        maxBorrowCapacityRaw: 2000n * 10n ** 6n,
        maxBorrowCapacityFormatted: "2,000.00 EURC",
        principalDebtRaw: 1000n * 10n ** 6n,
        principalDebtFormatted: "1,000.00 EURC",
        accumulatedInterestRaw: 5n * 10n ** 6n,
        accumulatedInterestFormatted: "5.00 EURC",
        pendingInterestRaw: 1n * 10n ** 6n,
        pendingInterestFormatted: "1.00 EURC",
        totalDebtRaw: 1006n * 10n ** 6n,
        totalDebtFormatted: "1,006.00 EURC",
        remainingBorrowCapacityRaw: 994n * 10n ** 6n,
        remainingBorrowCapacityFormatted: "994.00 EURC",
        currentLtvPercent: "25.15%",
        healthFactorRaw: 2780000000000000000n,
        healthFactorFormatted: "2.78 (🟢 HEALTHY)",
        healthStatus: "HEALTHY" as const,
      };

      const table = formatVaultDetailsTable(sampleDetails);

      expect(table).to.include("HoloFi Collateral Vault Details");
      expect(table).to.include("Vault ID           : #1");
      expect(table).to.include("Vault Status       : ACTIVE [Borrowing & Collateral Active]");
      expect(table).to.include("Vault Owner (Store): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (KYB: APPROVED ✅)");
      expect(table).to.include("Lending Pool       : Premium Pool EURC (pEURC)");
      expect(table).to.include("Max LTV: 50.00%");
      expect(table).to.include("Total Collateral   : 4,000.00 EUR");
      expect(table).to.include("Max Borrow Limit   : 2,000.00 EURC");
      expect(table).to.include("Total Debt         : 1,006.00 EURC");
      expect(table).to.include("Health Factor (HF) : 2.78 (🟢 HEALTHY)");
    });
  });
});
