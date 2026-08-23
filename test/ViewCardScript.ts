import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { network } from "hardhat";
import {
  parseCliArgs,
  fetchCardDetails,
  formatCardDetailsTable,
  resolveVaultCardAddress,
  resolvePriceFeedAddress,
  resolveLoanCoreAddress,
  VAULT_CARD_ABI,
  PRICE_FEED_ABI,
  LOAN_CORE_ABI,
  type CardDetails,
  type VaultLockInfo,
} from "../scripts/view-card.js";

const { ethers, networkHelpers } = await network.create();

describe("ViewCard CLI Script Integration Tests", function () {
  async function deployProtocolFixture() {
    const [owner, admin, minter, oracle, user, unauthorized, store] =
      await ethers.getSigners();

    const acm = await ethers.deployContract("AccessControlManager", [
      admin.address,
    ]);
    const minterRole = await acm.MINTER_ROLE();
    const oracleRole = await acm.ORACLE_ROLE();
    const adminRole = await acm.ADMIN_ROLE();

    await acm.connect(admin).grantRole(minterRole, minter.address);
    await acm.connect(admin).grantRole(oracleRole, oracle.address);

    const vaultCard = await ethers.deployContract("HoloFiVaultCard", [
      "HoloFi TCG Cards",
      "HFC",
      await acm.getAddress(),
    ]);

    const priceFeed = await ethers.deployContract("HoloFiCardPriceFeed", [
      await acm.getAddress(),
    ]);

    const poolFactory = await ethers.deployContract("HoloFiLendingPoolFactory", [
      await acm.getAddress(),
    ]);

    const loanCore = await ethers.deployContract("HoloFiVaultLoanCore", [
      await acm.getAddress(),
      await vaultCard.getAddress(),
      await poolFactory.getAddress(),
      await priceFeed.getAddress(),
    ]);

    await acm.connect(admin).grantRole(adminRole, await loanCore.getAddress());
    await acm.connect(admin).setKybStatus(store.address, true);

    const cardTypeId1 = ethers.keccak256(
      ethers.toUtf8Bytes("Charizard_1st_Edition")
    );
    const cardTypeId2 = ethers.keccak256(
      ethers.toUtf8Bytes("Pikachu_Illustrator")
    );
    const attestationHash1 = ethers.keccak256(
      ethers.toUtf8Bytes("Blink:PSA:10:999")
    );

    const eurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    await poolFactory.connect(admin).createPool(
      await eurc.getAddress(),
      "Pool EURC",
      "pEURC",
      5000n,
      7000n,
      1000n,
      500n
    );
    const poolAddr = await poolFactory.poolsByAsset(await eurc.getAddress(), 0n);

    return {
      acm,
      vaultCard,
      priceFeed,
      poolFactory,
      loanCore,
      poolAddr,
      owner,
      admin,
      minter,
      oracle,
      user,
      unauthorized,
      store,
      cardTypeId1,
      cardTypeId2,
      attestationHash1,
    };
  }

  describe("ABI definitions and exports", function () {
    it("Should export valid VAULT_CARD_ABI", function () {
      expect(VAULT_CARD_ABI).to.be.an("array").that.is.not.empty;
      expect(VAULT_CARD_ABI.some((sig) => sig.includes("getCard"))).to.be.true;
      expect(VAULT_CARD_ABI.some((sig) => sig.includes("ownerOf"))).to.be.true;
      expect(VAULT_CARD_ABI.some((sig) => sig.includes("tokenURI"))).to.be.true;
    });

    it("Should export valid PRICE_FEED_ABI", function () {
      expect(PRICE_FEED_ABI).to.be.an("array").that.is.not.empty;
      expect(PRICE_FEED_ABI.some((sig) => sig.includes("getPrice"))).to.be.true;
    });

    it("Should export valid LOAN_CORE_ABI", function () {
      expect(LOAN_CORE_ABI).to.be.an("array").that.is.not.empty;
      expect(LOAN_CORE_ABI.some((sig) => sig.includes("nftVaultId"))).to.be.true;
      expect(LOAN_CORE_ABI.some((sig) => sig.includes("getVault"))).to.be.true;
    });
  });

  describe("parseCliArgs", function () {
    it("Should parse numeric token ID as first positional argument", function () {
      const parsed = parseCliArgs(["node", "view-card.ts", "1"]);
      expect(parsed.tokenId).to.equal(1n);
      expect(parsed.vaultCardAddress).to.be.undefined;
      expect(parsed.priceFeedAddress).to.be.undefined;
    });

    it("Should parse numeric token ID and contract address positional arguments", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "view-card.ts", "42", cardAddr]);
      expect(parsed.tokenId).to.equal(42n);
      expect(parsed.vaultCardAddress).to.equal(cardAddr);
    });

    it("Should parse token ID, vault card address, and price feed address positionally", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const feedAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const parsed = parseCliArgs(["node", "view-card.ts", "100", cardAddr, feedAddr]);
      expect(parsed.tokenId).to.equal(100n);
      expect(parsed.vaultCardAddress).to.equal(cardAddr);
      expect(parsed.priceFeedAddress).to.equal(feedAddr);
    });

    it("Should parse when contract address is first and token ID is second", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs(["node", "view-card.ts", cardAddr, "42"]);
      expect(parsed.tokenId).to.equal(42n);
      expect(parsed.vaultCardAddress).to.equal(cardAddr);
    });

    it("Should parse --contract, --vault-card, --card, and -c flags", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

      const p1 = parseCliArgs(["node", "view-card.ts", "1", "--contract", cardAddr]);
      expect(p1.tokenId).to.equal(1n);
      expect(p1.vaultCardAddress).to.equal(cardAddr);

      const p2 = parseCliArgs(["node", "view-card.ts", "1", `--contract=${cardAddr}`]);
      expect(p2.vaultCardAddress).to.equal(cardAddr);

      const p3 = parseCliArgs(["node", "view-card.ts", "1", "--vault-card", cardAddr]);
      expect(p3.vaultCardAddress).to.equal(cardAddr);

      const p4 = parseCliArgs(["node", "view-card.ts", "1", `--vault-card=${cardAddr}`]);
      expect(p4.vaultCardAddress).to.equal(cardAddr);

      const p5 = parseCliArgs(["node", "view-card.ts", "1", "--card", cardAddr]);
      expect(p5.vaultCardAddress).to.equal(cardAddr);

      const p6 = parseCliArgs(["node", "view-card.ts", "1", `-c`, cardAddr]);
      expect(p6.vaultCardAddress).to.equal(cardAddr);
    });

    it("Should parse --price-feed, --pricefeed, and -p flags", function () {
      const feedAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

      const p1 = parseCliArgs(["node", "view-card.ts", "1", "--price-feed", feedAddr]);
      expect(p1.priceFeedAddress).to.equal(feedAddr);

      const p2 = parseCliArgs(["node", "view-card.ts", "1", `--price-feed=${feedAddr}`]);
      expect(p2.priceFeedAddress).to.equal(feedAddr);

      const p3 = parseCliArgs(["node", "view-card.ts", "1", "--pricefeed", feedAddr]);
      expect(p3.priceFeedAddress).to.equal(feedAddr);

      const p4 = parseCliArgs(["node", "view-card.ts", "1", `-p`, feedAddr]);
      expect(p4.priceFeedAddress).to.equal(feedAddr);
    });

    it("Should parse --loan-core, --loancore, and -l flags", function () {
      const coreAddr = "0x90f79BF6Eb2c4F809663852283088995309D4123";

      const p1 = parseCliArgs(["node", "view-card.ts", "1", "--loan-core", coreAddr]);
      expect(p1.loanCoreAddress).to.equal(coreAddr);

      const p2 = parseCliArgs(["node", "view-card.ts", "1", `--loan-core=${coreAddr}`]);
      expect(p2.loanCoreAddress).to.equal(coreAddr);

      const p3 = parseCliArgs(["node", "view-card.ts", "1", "--loancore", coreAddr]);
      expect(p3.loanCoreAddress).to.equal(coreAddr);

      const p4 = parseCliArgs(["node", "view-card.ts", "1", `--loancore=${coreAddr}`]);
      expect(p4.loanCoreAddress).to.equal(coreAddr);

      const p5 = parseCliArgs(["node", "view-card.ts", "1", "-l", coreAddr]);
      expect(p5.loanCoreAddress).to.equal(coreAddr);
    });

    it("Should parse --network and -n flags", function () {
      const p1 = parseCliArgs(["node", "view-card.ts", "1", "--network", "sepolia"]);
      expect(p1.networkName).to.equal("sepolia");

      const p2 = parseCliArgs(["node", "view-card.ts", "1", "--network=baseSepolia"]);
      expect(p2.networkName).to.equal("baseSepolia");

      const p3 = parseCliArgs(["node", "view-card.ts", "1", "-n", "mainnet"]);
      expect(p3.networkName).to.equal("mainnet");
    });

    it("Should parse arguments after double dash '--'", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const parsed = parseCliArgs([
        "node",
        "hardhat",
        "run",
        "scripts/view-card.ts",
        "--network",
        "localhost",
        "--",
        "5",
        cardAddr,
      ]);
      expect(parsed.tokenId).to.equal(5n);
      expect(parsed.vaultCardAddress).to.equal(cardAddr);
    });

    it("Should parse --help, -h, and help flags", function () {
      expect(parseCliArgs(["node", "view-card.ts", "--help"]).help).to.be.true;
      expect(parseCliArgs(["node", "view-card.ts", "-h"]).help).to.be.true;
      expect(parseCliArgs(["node", "view-card.ts", "help"]).help).to.be.true;
    });

    it("Should parse environment variables when CLI args are absent", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const feedAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const coreAddr = "0x90f79BF6Eb2c4F809663852283088995309D4123";

      process.env.TOKEN_ID = "77";
      process.env.VAULT_CARD_ADDRESS = cardAddr;
      process.env.PRICE_FEED_ADDRESS = feedAddr;
      process.env.LOAN_CORE_ADDRESS = coreAddr;
      process.env.HARDHAT_NETWORK = "sepolia";

      try {
        const parsed = parseCliArgs(["node", "view-card.ts"]);
        expect(parsed.tokenId).to.equal(77n);
        expect(parsed.vaultCardAddress).to.equal(cardAddr);
        expect(parsed.priceFeedAddress).to.equal(feedAddr);
        expect(parsed.loanCoreAddress).to.equal(coreAddr);
        expect(parsed.networkName).to.equal("sepolia");
      } finally {
        delete process.env.TOKEN_ID;
        delete process.env.VAULT_CARD_ADDRESS;
        delete process.env.PRICE_FEED_ADDRESS;
        delete process.env.LOAN_CORE_ADDRESS;
        delete process.env.HARDHAT_NETWORK;
      }
    });

    it("Should parse alternative environment variable names (CARD_TOKEN_ID, CARD_ADDRESS, FEED_ADDRESS, VAULT_LOAN_CORE_ADDRESS)", function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const feedAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const coreAddr = "0x90f79BF6Eb2c4F809663852283088995309D4123";

      process.env.CARD_TOKEN_ID = "88";
      process.env.CARD_ADDRESS = cardAddr;
      process.env.FEED_ADDRESS = feedAddr;
      process.env.VAULT_LOAN_CORE_ADDRESS = coreAddr;

      try {
        const parsed = parseCliArgs(["node", "view-card.ts"]);
        expect(parsed.tokenId).to.equal(88n);
        expect(parsed.vaultCardAddress).to.equal(cardAddr);
        expect(parsed.priceFeedAddress).to.equal(feedAddr);
        expect(parsed.loanCoreAddress).to.equal(coreAddr);
      } finally {
        delete process.env.CARD_TOKEN_ID;
        delete process.env.CARD_ADDRESS;
        delete process.env.FEED_ADDRESS;
        delete process.env.VAULT_LOAN_CORE_ADDRESS;
      }
    });
  });

  describe("resolveVaultCardAddress", function () {
    it("Should prioritize CLI address when valid", async function () {
      const cardAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const resolved = await resolveVaultCardAddress(ethers.provider, cardAddr);
      expect(resolved).to.equal(cardAddr);
    });

    it("Should resolve from VAULT_CARD_ADDRESS environment variable", async function () {
      const cardAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      process.env.VAULT_CARD_ADDRESS = cardAddr;
      try {
        const resolved = await resolveVaultCardAddress(ethers.provider);
        expect(resolved).to.equal(cardAddr);
      } finally {
        delete process.env.VAULT_CARD_ADDRESS;
      }
    });

    it("Should resolve from CONTRACT_ADDRESS environment variable", async function () {
      const cardAddr = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
      process.env.CONTRACT_ADDRESS = cardAddr;
      try {
        const resolved = await resolveVaultCardAddress(ethers.provider);
        expect(resolved).to.equal(cardAddr);
      } finally {
        delete process.env.CONTRACT_ADDRESS;
      }
    });

    it("Should resolve from networkName mapping (e.g. baseSepolia) even if provider fails", async function () {
      const failingProvider = {
        getNetwork: async () => {
          throw new Error("RPC unreachable");
        },
      } as any;

      const resolved = await resolveVaultCardAddress(
        failingProvider,
        undefined,
        process.cwd(),
        "baseSepolia"
      );
      expect(resolved).to.equal("0xC69CD882EEDE3802cEAcdbde965F3b18de9d223F");
    });

    it("Should throw error if address cannot be resolved", async function () {
      const savedCard = process.env.VAULT_CARD_ADDRESS;
      const savedCard2 = process.env.CARD_ADDRESS;
      const savedCard3 = process.env.CONTRACT_ADDRESS;
      delete process.env.VAULT_CARD_ADDRESS;
      delete process.env.CARD_ADDRESS;
      delete process.env.CONTRACT_ADDRESS;

      try {
        let threw = false;
        try {
          await resolveVaultCardAddress(ethers.provider, undefined, "/non/existent/dir");
        } catch (err: any) {
          threw = true;
          expect(err.message).to.include("Could not resolve HoloFiVaultCard contract address");
        }
        expect(threw, "Expected resolveVaultCardAddress to throw").to.be.true;
      } finally {
        if (savedCard) process.env.VAULT_CARD_ADDRESS = savedCard;
        if (savedCard2) process.env.CARD_ADDRESS = savedCard2;
        if (savedCard3) process.env.CONTRACT_ADDRESS = savedCard3;
      }
    });
  });

  describe("resolvePriceFeedAddress", function () {
    it("Should prioritize CLI address when valid", async function () {
      const feedAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const resolved = await resolvePriceFeedAddress(ethers.provider, process.cwd(), feedAddr);
      expect(resolved).to.equal(feedAddr);
    });

    it("Should resolve from PRICE_FEED_ADDRESS environment variable", async function () {
      const feedAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      process.env.PRICE_FEED_ADDRESS = feedAddr;
      try {
        const resolved = await resolvePriceFeedAddress(ethers.provider);
        expect(resolved).to.equal(feedAddr);
      } finally {
        delete process.env.PRICE_FEED_ADDRESS;
      }
    });

    it("Should resolve from networkName mapping (e.g. baseSepolia)", async function () {
      const failingProvider = {
        getNetwork: async () => {
          throw new Error("RPC unreachable");
        },
      } as any;

      const resolved = await resolvePriceFeedAddress(
        failingProvider,
        process.cwd(),
        undefined,
        "baseSepolia"
      );
      expect(resolved).to.equal("0xcdF24c4DAB40F9bB4864bF115AcF751df8238e40");
    });

    it("Should return null when price feed cannot be resolved", async function () {
      const savedFeed = process.env.PRICE_FEED_ADDRESS;
      const savedFeed2 = process.env.FEED_ADDRESS;
      delete process.env.PRICE_FEED_ADDRESS;
      delete process.env.FEED_ADDRESS;

      try {
        const resolved = await resolvePriceFeedAddress(
          ethers.provider,
          "/non/existent/dir"
        );
        expect(resolved).to.be.null;
      } finally {
        if (savedFeed) process.env.PRICE_FEED_ADDRESS = savedFeed;
        if (savedFeed2) process.env.FEED_ADDRESS = savedFeed2;
      }
    });
  });

  describe("resolveLoanCoreAddress", function () {
    it("Should prioritize CLI address when valid", async function () {
      const coreAddr = "0x90f79BF6Eb2c4F809663852283088995309D4123";
      const resolved = await resolveLoanCoreAddress(
        ethers.provider,
        process.cwd(),
        coreAddr
      );
      expect(resolved).to.equal(coreAddr);
    });

    it("Should resolve from LOAN_CORE_ADDRESS environment variable", async function () {
      const coreAddr = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      process.env.LOAN_CORE_ADDRESS = coreAddr;
      try {
        const resolved = await resolveLoanCoreAddress(ethers.provider);
        expect(resolved).to.equal(coreAddr);
      } finally {
        delete process.env.LOAN_CORE_ADDRESS;
      }
    });

    it("Should resolve from VAULT_LOAN_CORE_ADDRESS environment variable", async function () {
      const coreAddr = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
      process.env.VAULT_LOAN_CORE_ADDRESS = coreAddr;
      try {
        const resolved = await resolveLoanCoreAddress(ethers.provider);
        expect(resolved).to.equal(coreAddr);
      } finally {
        delete process.env.VAULT_LOAN_CORE_ADDRESS;
      }
    });

    it("Should resolve from networkName mapping (e.g. baseSepolia)", async function () {
      const failingProvider = {
        getNetwork: async () => {
          throw new Error("RPC unreachable");
        },
      } as any;

      const resolved = await resolveLoanCoreAddress(
        failingProvider,
        process.cwd(),
        undefined,
        "baseSepolia"
      );
      expect(resolved).to.equal("0x20fEeDf9b0A4fd00b0B383Aa7639C310335B95Bc");
    });

    it("Should return null when loan core cannot be resolved", async function () {
      const savedCore = process.env.LOAN_CORE_ADDRESS;
      const savedCore2 = process.env.VAULT_LOAN_CORE_ADDRESS;
      delete process.env.LOAN_CORE_ADDRESS;
      delete process.env.VAULT_LOAN_CORE_ADDRESS;

      try {
        const resolved = await resolveLoanCoreAddress(
          ethers.provider,
          "/non/existent/dir"
        );
        expect(resolved).to.be.null;
      } finally {
        if (savedCore) process.env.LOAN_CORE_ADDRESS = savedCore;
        if (savedCore2) process.env.VAULT_LOAN_CORE_ADDRESS = savedCore2;
      }
    });
  });

  describe("fetchCardDetails integration", function () {
    it("Should fetch full card details and oracle valuation for minted card", async function () {
      const { vaultCard, priceFeed, minter, oracle, user, cardTypeId1, attestationHash1 } =
        await networkHelpers.loadFixture(deployProtocolFixture);

      const tokenUri = "ipfs://QmTestCardMetadata1";
      await vaultCard.connect(minter).mintCard(user.address, cardTypeId1, attestationHash1, tokenUri);

      const price = ethers.parseUnits("2000", 18);
      await priceFeed.connect(oracle).setPrice(cardTypeId1, price);

      const details = await fetchCardDetails(vaultCard, 1n, priceFeed);

      expect(details.tokenId).to.equal(1n);
      expect(details.contractAddress).to.equal(await vaultCard.getAddress());
      expect(details.contractName).to.equal("HoloFi TCG Cards");
      expect(details.contractSymbol).to.equal("HFC");
      expect(details.owner).to.equal(user.address);
      expect(details.tokenURI).to.equal(tokenUri);
      expect(details.cardTypeId).to.equal(cardTypeId1);
      expect(details.attestationHash).to.equal(attestationHash1);
      expect(details.isLocked).to.be.false;
      expect(details.mintTimestamp).to.be.greaterThan(0n);
      expect(details.mintDate).to.match(/^\d{4}-\d{2}-\d{2}T/);

      expect(details.priceFeedAddress).to.equal(await priceFeed.getAddress());
      expect(details.priceInfo).to.not.be.undefined;
      expect(details.priceInfo?.priceRaw).to.equal(price);
      expect(details.priceInfo?.priceFormatted).to.include("$2,000.00 USD");
      expect(details.priceInfo?.lastUpdated).to.be.greaterThan(0n);
      expect(details.priceInfo?.lastUpdatedDate).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("Should fetch card details when price feed is omitted (null)", async function () {
      const { vaultCard, minter, user, cardTypeId1, attestationHash1 } =
        await networkHelpers.loadFixture(deployProtocolFixture);

      await vaultCard.connect(minter).mintCard(user.address, cardTypeId1, attestationHash1, "ipfs://QmTest");

      const details = await fetchCardDetails(vaultCard, 1n, null);
      expect(details.tokenId).to.equal(1n);
      expect(details.owner).to.equal(user.address);
      expect(details.priceFeedAddress).to.be.undefined;
      expect(details.priceInfo).to.be.undefined;
    });

    it("Should gracefully handle unpriced / unregistered card type in price feed", async function () {
      const { vaultCard, priceFeed, minter, user, cardTypeId2, attestationHash1 } =
        await networkHelpers.loadFixture(deployProtocolFixture);

      // Mint card with cardTypeId2 which is NOT priced in price feed
      await vaultCard.connect(minter).mintCard(user.address, cardTypeId2, attestationHash1, "ipfs://QmUnpriced");

      const details = await fetchCardDetails(vaultCard, 1n, priceFeed);
      expect(details.tokenId).to.equal(1n);
      expect(details.cardTypeId).to.equal(cardTypeId2);
      expect(details.priceFeedAddress).to.equal(await priceFeed.getAddress());
      expect(details.priceInfo?.priceRaw).to.equal(0n);
      expect(details.priceInfo?.priceFormatted).to.include("$0.00 USD (Not set)");
    });

    it("Should reflect locked status when card is locked", async function () {
      const { vaultCard, admin, minter, user, cardTypeId1, attestationHash1 } =
        await networkHelpers.loadFixture(deployProtocolFixture);

      await vaultCard.connect(minter).mintCard(user.address, cardTypeId1, attestationHash1, "ipfs://QmLocked");

      // Admin locks Card #1
      await vaultCard.connect(admin).setCardLock(1n, true);

      const details = await fetchCardDetails(vaultCard, 1n);
      expect(details.isLocked).to.be.true;
    });

    it("Should fetch card details and vault lock info when card is locked in loan core vault", async function () {
      const {
        vaultCard,
        priceFeed,
        loanCore,
        poolAddr,
        minter,
        oracle,
        store,
        cardTypeId1,
        attestationHash1,
      } = await networkHelpers.loadFixture(deployProtocolFixture);

      const tokenUri = "ipfs://QmTestCardInVault1";
      await vaultCard
        .connect(minter)
        .mintCard(store.address, cardTypeId1, attestationHash1, tokenUri);

      const price = ethers.parseUnits("3500", 18);
      await priceFeed.connect(oracle).setPrice(cardTypeId1, price);

      const loanCoreAddress = await loanCore.getAddress();

      // Store creates vault #1, approves loanCore, and deposits collateral
      await loanCore.connect(store).createVault(poolAddr);
      await vaultCard.connect(store).setApprovalForAll(loanCoreAddress, true);
      await loanCore.connect(store).depositCollateral(1n, [1n]);

      const details = await fetchCardDetails(
        vaultCard,
        1n,
        priceFeed,
        loanCore
      );

      expect(details.tokenId).to.equal(1n);
      expect(details.owner).to.equal(loanCoreAddress);
      expect(details.isLocked).to.be.true;
      expect(details.loanCoreAddress).to.equal(loanCoreAddress);

      expect(details.vaultLockInfo).to.not.be.undefined;
      expect(details.vaultLockInfo?.vaultId).to.equal(1n);
      expect(details.vaultLockInfo?.vaultOwner).to.equal(store.address);
      expect(details.vaultLockInfo?.vaultStatus).to.equal("Active");
      expect(details.vaultLockInfo?.loanCoreAddress).to.equal(loanCoreAddress);
      expect(details.vaultLockInfo?.principalDebt).to.equal(0n);
      expect(details.vaultLockInfo?.accumulatedInterest).to.equal(0n);

      const table = formatCardDetailsTable(details);
      expect(table).to.include(
        "Lock Status        : LOCKED [In Escrow / Collateralized]"
      );
      expect(table).to.include(
        "Locked in Vault    : Vault #1 (Status: Active)"
      );
      expect(table).to.include(`Vault Owner (Store): ${store.address}`);
      expect(table).to.include(`Loan Core Escrow   : ${loanCoreAddress}`);
      expect(table).to.include("$3,500.00 USD");
    });

    it("Should throw error for burned card", async function () {
      const { vaultCard, minter, user, cardTypeId1, attestationHash1 } =
        await networkHelpers.loadFixture(deployProtocolFixture);

      await vaultCard.connect(minter).mintCard(user.address, cardTypeId1, attestationHash1, "ipfs://QmBurn");
      await vaultCard.connect(user).burnCard(1n);

      let threw = false;
      try {
        await fetchCardDetails(vaultCard, 1n);
      } catch {
        threw = true;
      }
      expect(threw, "Expected fetchCardDetails to throw for burned token").to.be.true;
    });

    it("Should throw error for non-existent token ID", async function () {
      const { vaultCard } = await networkHelpers.loadFixture(deployProtocolFixture);

      let threw = false;
      try {
        await fetchCardDetails(vaultCard, 999n);
      } catch {
        threw = true;
      }
      expect(threw, "Expected fetchCardDetails to throw for non-existent token").to.be.true;
    });
  });

  describe("formatCardDetailsTable", function () {
    it("Should format complete CardDetails with valuation into table", function () {
      const details: CardDetails = {
        tokenId: 1n,
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        contractName: "HoloFi TCG Cards",
        contractSymbol: "HFC",
        owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenURI: "ipfs://QmTestURI",
        cardTypeId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        attestationHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        mintTimestamp: 1700000000n,
        mintDate: "2023-11-14T22:13:20.000Z",
        isLocked: false,
        priceFeedAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        priceInfo: {
          priceRaw: 2000000000000000000000n,
          priceFormatted: "$2,000.00 USD (2000.0 USD)",
          lastUpdated: 1700000100n,
          lastUpdatedDate: "2023-11-14T22:15:00.000Z",
        },
      };

      const table = formatCardDetailsTable(details);

      expect(table).to.include("HoloFi Vault Card NFT Metadata");
      expect(table).to.include("Token ID           : 1");
      expect(table).to.include("0x5FbDB2315678afecb367f032d93F642f64180aa3");
      expect(table).to.include("HoloFi TCG Cards - HFC");
      expect(table).to.include("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      expect(table).to.include("UNLOCKED [Free / Transferable]");
      expect(table).to.include("ipfs://QmTestURI");
      expect(table).to.include("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      expect(table).to.include("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
      expect(table).to.include("ORACLE VALUATION (FMV)");
      expect(table).to.include("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
      expect(table).to.include("$2,000.00 USD (2000.0 USD)");
    });

    it("Should format locked card status indicator correctly", function () {
      const details: CardDetails = {
        tokenId: 2n,
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        contractName: "HoloFi TCG Cards",
        contractSymbol: "HFC",
        owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenURI: "",
        cardTypeId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        attestationHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        mintTimestamp: 1700000000n,
        mintDate: "2023-11-14T22:13:20.000Z",
        isLocked: true,
      };

      const table = formatCardDetailsTable(details);
      expect(table).to.include("LOCKED [In Escrow / Collateralized]");
      expect(table).to.include("Token URI          : (empty)");
      expect(table).to.include("Price Feed         : Not configured / unavailable");
      expect(table).to.include("Fair Market Value  : N/A");
    });

    it("Should format locked card with vaultLockInfo into table correctly", function () {
      const details: CardDetails = {
        tokenId: 1n,
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        contractName: "HoloFi TCG Cards",
        contractSymbol: "HFC",
        owner: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
        tokenURI: "ipfs://QmTestURI",
        cardTypeId:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        attestationHash:
          "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        mintTimestamp: 1700000000n,
        mintDate: "2023-11-14T22:13:20.000Z",
        isLocked: true,
        loanCoreAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
        vaultLockInfo: {
          vaultId: 1n,
          vaultOwner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          loanCoreAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
          vaultStatus: "Active",
          principalDebt: 0n,
          accumulatedInterest: 0n,
        },
      };

      const table = formatCardDetailsTable(details);
      expect(table).to.include(
        "Lock Status        : LOCKED [In Escrow / Collateralized]"
      );
      expect(table).to.include("Locked in Vault    : Vault #1 (Status: Active)");
      expect(table).to.include(
        "Vault Owner (Store): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
      );
      expect(table).to.include(
        "Loan Core Escrow   : 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
      );
    });

    it("Should format unpriced card type correctly when price feed exists without price", function () {
      const details: CardDetails = {
        tokenId: 3n,
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        contractName: "HoloFi TCG Cards",
        contractSymbol: "HFC",
        owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        tokenURI: "https://example.com/nft/3",
        cardTypeId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        attestationHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        mintTimestamp: 1700000000n,
        mintDate: "2023-11-14T22:13:20.000Z",
        isLocked: false,
        priceFeedAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      };

      const table = formatCardDetailsTable(details);
      expect(table).to.include("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
      expect(table).to.include("Fair Market Value  : Not available or card type unpriced in registry");
    });
  });
});
