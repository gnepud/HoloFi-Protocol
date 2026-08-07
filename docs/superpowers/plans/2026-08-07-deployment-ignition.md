# Hardhat Ignition Deployment Module & Verification Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic, modular Hardhat Ignition deployment module (`ignition/modules/DeployHoloFiProtocol.ts`) for HoloFi protocol, configure `hardhat.config.ts`, and create an automated interconnectivity verification test suite (`test/DeployHoloFiProtocol.ts`).

**Architecture:** Configure `@nomicfoundation/hardhat-ignition` plugin in `hardhat.config.ts`. Define `DeployHoloFiProtocol` Ignition module orchestrating 6 sequential contract deployments, contract wire-up calls (`setDutchAuction`, `setTreasury`), and operational role grants (`ORACLE_ROLE`, `MINTER_ROLE`). Create verification test suite asserting interconnectivity state getters and role assignments.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Hardhat Ignition (`@nomicfoundation/hardhat-ignition`), Ethers v6, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Configure Hardhat Ignition & Create `ignition/modules/DeployHoloFiProtocol.ts`

**Files:**
- Modify: `hardhat.config.ts`
- Create: `ignition/modules/DeployHoloFiProtocol.ts`

**Interfaces:**
- Produces: `DeployHoloFiProtocol` Ignition module exporting deployed protocol contract futures.

- [ ] **Step 1: Configure `hardhat.config.ts`**

In `hardhat.config.ts`:

```ts
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatIgnitionPlugin from "@nomicfoundation/hardhat-ignition";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatIgnitionPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  // ... rest of config
});
```

- [ ] **Step 2: Create `ignition/modules/DeployHoloFiProtocol.ts`**

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const DeployHoloFiProtocol = buildModule("DeployHoloFiProtocol", (m) => {
  const initialAdmin = m.getAccount(0);
  const oracleFeeder = m.getParameter("oracleFeeder", initialAdmin);
  const minter = m.getParameter("minter", initialAdmin);
  const treasury = m.getParameter("treasury", initialAdmin);

  // 1. AccessControlManager
  const acm = m.contract("AccessControlManager", [initialAdmin]);

  // 2. HoloFiVaultCard
  const vaultCard = m.contract("HoloFiVaultCard", [
    "HoloFi Vaulted TCG Cards",
    "HFC",
    acm,
  ]);

  // 3. HoloFiCardPriceFeed
  const priceFeed = m.contract("HoloFiCardPriceFeed", [acm]);

  // 4. HoloFiLendingPoolFactory
  const poolFactory = m.contract("HoloFiLendingPoolFactory", [acm]);

  // 5. HoloFiVaultLoanCore
  const loanCore = m.contract("HoloFiVaultLoanCore", [
    acm,
    vaultCard,
    poolFactory,
    priceFeed,
  ]);

  // 6. HoloFiDutchAuction
  const dutchAuction = m.contract("HoloFiDutchAuction", [
    acm,
    loanCore,
    poolFactory,
  ]);

  // Interconnectivity Wire-up Calls
  m.call(loanCore, "setDutchAuction", [dutchAuction]);
  m.call(dutchAuction, "setTreasury", [treasury]);

  // Role Assignments via ACM
  const ORACLE_ROLE = m.staticCall(acm, "ORACLE_ROLE");
  const MINTER_ROLE = m.staticCall(acm, "MINTER_ROLE");

  m.call(acm, "grantRole", [ORACLE_ROLE, oracleFeeder]);
  m.call(acm, "grantRole", [MINTER_ROLE, minter]);

  return {
    acm,
    vaultCard,
    priceFeed,
    poolFactory,
    loanCore,
    dutchAuction,
  };
});

export default DeployHoloFiProtocol;
```

- [ ] **Step 3: Verify build and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 4: Commit Task 1**

```bash
git add hardhat.config.ts ignition/modules/DeployHoloFiProtocol.ts
git commit -m "feat(HF-48): add Hardhat Ignition deployment module for HoloFi protocol (relates to HF-48)"
```

---

### Task 2: Implement Hardhat Ignition Automated Verification Suite (`test/DeployHoloFiProtocol.ts`)

**Files:**
- Create: `test/DeployHoloFiProtocol.ts`

**Interfaces:**
- Produces: Automated integration test suite verifying `DeployHoloFiProtocol` deployment execution and contract interconnectivity.

- [ ] **Step 1: Create `test/DeployHoloFiProtocol.ts`**

```ts
import { expect } from "chai";
import { ethers, ignition } from "hardhat";
import DeployHoloFiProtocol from "../ignition/modules/DeployHoloFiProtocol.js";

describe("Hardhat Ignition Deployment Verification Suite", function () {
  it("Should deploy full HoloFi protocol via Ignition and verify interconnectivity and role assignments", async function () {
    const [admin, oracleFeeder, minter, treasury] = await ethers.getSigners();

    const { acm, vaultCard, priceFeed, poolFactory, loanCore, dutchAuction } = await ignition.deploy(
      DeployHoloFiProtocol,
      {
        parameters: {
          DeployHoloFiProtocol: {
            oracleFeeder: oracleFeeder.address,
            minter: minter.address,
            treasury: treasury.address,
          },
        },
      }
    );

    const acmAddr = await acm.getAddress();
    const vaultCardAddr = await vaultCard.getAddress();
    const priceFeedAddr = await priceFeed.getAddress();
    const poolFactoryAddr = await poolFactory.getAddress();
    const loanCoreAddr = await loanCore.getAddress();
    const dutchAuctionAddr = await dutchAuction.getAddress();

    // Verify non-zero contract addresses
    expect(acmAddr).to.not.equal(ethers.ZeroAddress);
    expect(vaultCardAddr).to.not.equal(ethers.ZeroAddress);
    expect(priceFeedAddr).to.not.equal(ethers.ZeroAddress);
    expect(poolFactoryAddr).to.not.equal(ethers.ZeroAddress);
    expect(loanCoreAddr).to.not.equal(ethers.ZeroAddress);
    expect(dutchAuctionAddr).to.not.equal(ethers.ZeroAddress);

    // Verify LoanCore contract references
    expect(await loanCore.acm()).to.equal(acmAddr);
    expect(await loanCore.vaultCard()).to.equal(vaultCardAddr);
    expect(await loanCore.poolFactory()).to.equal(poolFactoryAddr);
    expect(await loanCore.priceFeed()).to.equal(priceFeedAddr);
    expect(await loanCore.dutchAuction()).to.equal(dutchAuctionAddr);

    // Verify DutchAuction contract references
    expect(await dutchAuction.acm()).to.equal(acmAddr);
    expect(await dutchAuction.loanCore()).to.equal(loanCoreAddr);
    expect(await dutchAuction.poolFactory()).to.equal(poolFactoryAddr);
    expect(await dutchAuction.treasury()).to.equal(treasury.address);

    // Verify role authorizations via ACM
    const ORACLE_ROLE = await acm.ORACLE_ROLE();
    const MINTER_ROLE = await acm.MINTER_ROLE();

    expect(await acm.hasRole(ORACLE_ROLE, oracleFeeder.address)).to.be.true;
    expect(await acm.hasRole(MINTER_ROLE, minter.address)).to.be.true;
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (157+ total tests).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/DeployHoloFiProtocol.ts
git commit -m "test(HF-48): add Hardhat Ignition deployment verification test suite (Fixes HF-48)"
```
