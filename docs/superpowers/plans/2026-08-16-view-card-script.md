# View Vault Card NFT Implementation Plan (`scripts/view-card.ts`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `scripts/view-card.ts` CLI tool allowing users and operators to view on-chain NFT metadata and price feed valuation for any `HoloFiVaultCard` by token ID.

**Architecture:** Build a TypeScript script that accepts `tokenId`, connects to the designated network, retrieves `ownerOf`, `tokenURI`, `getCard`, and optional `priceFeed.getPrice`, and outputs a formatted summary table. Add integration tests and update documentation.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Ethers v6, Mocha, Chai, Node.js fs.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `scripts/view-card.ts` & Update `package.json`

**Files:**
- Create: `scripts/view-card.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `fetchCardDetails(vaultCard, tokenId, priceFeed?)`, `formatCardDetailsTable(details)`, `parseCliArgs()`, `resolveVaultCardAddress()`.

- [ ] **Step 1: Create `scripts/view-card.ts`**

Implement CLI argument parsing, address resolution, `fetchCardDetails`, `formatCardDetailsTable`, `printHelp`, and `main`.

- [ ] **Step 2: Update `package.json`**

Add `"view-card": "tsx scripts/view-card.ts"` to `scripts`.

- [ ] **Step 3: Verify compilation and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 4: Commit Task 1**

```bash
git add scripts/view-card.ts package.json
git commit -m "feat: implement view-card CLI script for HoloFiVaultCard metadata"
```

---

### Task 2: Implement Integration Tests & Update Deployment Guide

**Files:**
- Create: `test/ViewCardScript.ts`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Produces: Integration tests for card inspection and updated documentation.

- [ ] **Step 1: Create `test/ViewCardScript.ts`**

Write integration tests validating argument parsing, card detail fetching across lifecycle states (minted, locked, burned), and ASCII table formatting.

- [ ] **Step 2: Update `docs/Deployment Guide.md`**

Add Section 5 detailing how to query card NFT details using `npm run view-card`.

- [ ] **Step 3: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (210+ total tests).

- [ ] **Step 4: Commit Task 2**

```bash
git add test/ViewCardScript.ts "docs/Deployment Guide.md"
git commit -m "test: add integration tests and documentation for view-card script"
```
