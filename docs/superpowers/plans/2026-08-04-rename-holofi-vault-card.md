# Rename and Standardize RWA Collateral Token Contract (`HoloFiVaultCard`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the primary ERC-721 physical card collateral token contract from `HoloFiCardCollection` to `HoloFiVaultCard` across all smart contracts, unit tests, integration tests, and documentation.

**Architecture:** Rename `contracts/HoloFiCardCollection.sol` $\rightarrow$ `contracts/HoloFiVaultCard.sol`, `contracts/HoloFiCardCollection.t.sol` $\rightarrow$ `contracts/HoloFiVaultCard.t.sol`, and `test/HoloFiCardCollection.ts` $\rightarrow$ `test/HoloFiVaultCard.ts`. Update contract definition `contract HoloFiVaultCard`, all import statements, type declarations (`HoloFiVaultCard public immutable nftCollection`), Ethers deployment scripts (`deployContract("HoloFiVaultCard", ...)`), and documentation.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Rename Smart Contracts, Solidity Unit Tests & Internal References

**Files:**
- Move: `contracts/HoloFiCardCollection.sol` $\rightarrow$ `contracts/HoloFiVaultCard.sol`
- Move: `contracts/HoloFiCardCollection.t.sol` $\rightarrow$ `contracts/HoloFiVaultCard.t.sol`
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: `HoloFiVaultCard` contract and references.

- [ ] **Step 1: Write file moves and update `contracts/HoloFiVaultCard.sol`**

Rename files and update `contracts/HoloFiVaultCard.sol`:

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
    struct CardMetadata {
        uint256 tokenId;
        bytes32 attestationHash;
        string tokenURI;
        bool isLocked;
    }
    // ... logic remains identical
```

- [ ] **Step 2: Update `contracts/HoloFiVaultCard.t.sol`, `contracts/HoloFiVaultLoanCore.sol`, `contracts/HoloFiVaultLoanCore.t.sol`, `contracts/HoloFiDutchAuction.t.sol`**

Update imports and type declarations to `HoloFiVaultCard`.

- [ ] **Step 3: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (104 total Solidity unit tests).

- [ ] **Step 4: Commit Task 1**

```bash
git add contracts/
git commit -m "feat(HF-37): rename HoloFiCardCollection to HoloFiVaultCard across contracts and Solidity tests (relates to HF-37)"
```

---

### Task 2: Rename TypeScript Integration Tests & Update Architecture Docs

**Files:**
- Move: `test/HoloFiCardCollection.ts` $\rightarrow$ `test/HoloFiVaultCard.ts`
- Modify: `test/HoloFiVaultLoanCore.ts`
- Modify: `test/HoloFiDutchAuction.ts`
- Modify: `AGENTS.md`
- Modify: `docs/System Architecture Document.md`

**Interfaces:**
- Produces: Fully updated TypeScript test suite and documentation.

- [ ] **Step 1: Move `test/HoloFiCardCollection.ts` $\rightarrow$ `test/HoloFiVaultCard.ts` and update deployment references**

Update Ethers contract deployment to `ethers.deployContract("HoloFiVaultCard", ...)` across all `.ts` files.

- [ ] **Step 2: Update `AGENTS.md` and `docs/System Architecture Document.md`**

Update references from `HoloFiCardCollection` to `HoloFiVaultCard`.

- [ ] **Step 3: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (139 total tests: 104 Solidity + 35 Mocha).

- [ ] **Step 4: Commit Task 2 with Linear Magic Word**

```bash
git add test/ AGENTS.md "docs/System Architecture Document.md"
git commit -m "test(HF-37): rename TypeScript integration tests and docs to HoloFiVaultCard (Fixes HF-37)"
```
