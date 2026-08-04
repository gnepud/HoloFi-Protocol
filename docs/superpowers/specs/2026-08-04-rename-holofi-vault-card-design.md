# Rename and Standardize RWA Collateral Token Contract (`HoloFiVaultCard`) Specification

- **Feature**: HF-37 — Rename and Standardize RWA Collateral Token Contract (`HoloFiVaultCard`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-04
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This refactoring renames the primary ERC-721 physical card collateral token contract from `HoloFiCardCollection` to `HoloFiVaultCard` across the entire codebase (contracts, unit tests, integration tests, scripts, and documentation) to accurately represent physical TCG assets vaulted by Blink.

---

## 2. Technical Specification

### 2.1 File Renaming Strategy
* `contracts/HoloFiCardCollection.sol` $\rightarrow$ `contracts/HoloFiVaultCard.sol`
* `contracts/HoloFiCardCollection.t.sol` $\rightarrow$ `contracts/HoloFiVaultCard.t.sol`
* `test/HoloFiCardCollection.ts` $\rightarrow$ `test/HoloFiVaultCard.ts`

### 2.2 Smart Contract Renaming (`contracts/HoloFiVaultCard.sol`)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC721, ERC721URIStorage } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiVaultCard
 * @notice Permissioned ERC-721 token contract representing physical card assets vaulted by Blink.
 */
contract HoloFiVaultCard is ERC721URIStorage {
    // ... logic remains identical
}
```

### 2.3 Reference Updates Across Smart Contracts
* **`contracts/HoloFiVaultLoanCore.sol`**:
  - `import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";`
  - `HoloFiVaultCard public immutable nftCollection;`
  - `nftCollection = HoloFiVaultCard(_nftCollection);`

### 2.4 Reference Updates Across Test Suites
* **`contracts/HoloFiVaultCard.t.sol`**:
  - `import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";`
  - `contract HoloFiVaultCardTest is Test`
  - `HoloFiVaultCard public cardCollection;`
  - `cardCollection = new HoloFiVaultCard("HoloFi TCG Cards", "HFC", address(acm));`
* **`contracts/HoloFiVaultLoanCore.t.sol`** & **`contracts/HoloFiDutchAuction.t.sol`**:
  - `import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";`
  - `HoloFiVaultCard public cardCollection;`
  - `HoloFiVaultCard.CardMetadata memory card1...`
* **`test/HoloFiVaultCard.ts`**, **`test/HoloFiVaultLoanCore.ts`**, **`test/HoloFiDutchAuction.ts`**:
  - `ethers.deployContract("HoloFiVaultCard", ...)`
  - Suite description: `HoloFiVaultCard Integration Tests`

### 2.5 Documentation Updates
* Update `AGENTS.md` and `docs/System Architecture Document.md` references from `HoloFiCardCollection` to `HoloFiVaultCard`.

---

## 3. Testing & Verification

- Run full compilation: `npx hardhat build`
- Run TypeScript check: `npx tsc --noEmit`
- Run complete test suite: `npx hardhat test` (All 139+ tests passing)
