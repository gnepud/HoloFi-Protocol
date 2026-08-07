# Hardhat Ignition Deployment Module & Verification Suite Specification

- **Feature**: HF-48 — Develop Deployment Scripts & Verification Suite (`Hardhat Ignition`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-07
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines the deterministic deployment pipeline for HoloFi protocol using **Hardhat Ignition**. It orchestrates the 6-contract deployment sequence, contract interconnectivity wire-ups, and post-deployment role authorizations. It includes an automated verification test suite verifying deployed contract interconnectivity.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Ignition Module**: `ignition/modules/DeployHoloFiProtocol.ts`
* **Hardhat Configuration**: `hardhat.config.ts` (Imports `@nomicfoundation/hardhat-ignition`)
* **Verification Test Suite**: `test/DeployHoloFiProtocol.ts`

---

### 2.2 Deployment Sequence & Module Architecture (`DeployHoloFiProtocol.ts`)

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

  // Post-Deployment Interconnectivity Wire-ups
  m.call(loanCore, "setDutchAuction", [dutchAuction]);
  m.call(dutchAuction, "setTreasury", [treasury]);

  // Operational Role Assignments via ACM
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

---

## 3. Testing & Verification Strategy

### 3.1 Hardhat Ignition Verification Suite (`test/DeployHoloFiProtocol.ts`)
Using Hardhat 3 `ignition.deploy(DeployHoloFiProtocol)`:
1. Verify contract address non-zero assertions for `acm`, `vaultCard`, `priceFeed`, `poolFactory`, `loanCore`, and `dutchAuction`.
2. Verify contract getters interconnectivity:
   - `loanCore.acm() == acmAddress`
   - `loanCore.vaultCard() == vaultCardAddress`
   - `loanCore.poolFactory() == poolFactoryAddress`
   - `loanCore.priceFeed() == priceFeedAddress`
   - `loanCore.dutchAuction() == dutchAuctionAddress`
   - `dutchAuction.acm() == acmAddress`
   - `dutchAuction.loanCore() == loanCoreAddress`
   - `dutchAuction.poolFactory() == poolFactoryAddress`
   - `dutchAuction.treasury() == treasuryAddress`
3. Verify role authorizations:
   - `acm.hasRole(ORACLE_ROLE, oracleFeeder) == true`
   - `acm.hasRole(MINTER_ROLE, minter) == true`

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 156+ tests passing, including `DeployHoloFiProtocol.ts`)
