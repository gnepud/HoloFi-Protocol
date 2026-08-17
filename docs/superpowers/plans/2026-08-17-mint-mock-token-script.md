# Mint Mock Token Script Implementation Plan (`scripts/mint-mock-token.ts`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `scripts/mint-mock-token.ts` CLI tool allowing users and operators to mint `MockERC20` tokens (e.g. Mock EURC) to any specified wallet address and check balances.

**Architecture:** Build a standalone TypeScript script that accepts recipient address and amount, resolves the deployed `MockERC20` contract address, automatically scales human numbers by `token.decimals()`, submits the mint transaction, and reports balance changes. Add integration tests and update documentation.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Ethers v6, Mocha, Chai, Node.js fs.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `scripts/mint-mock-token.ts` & Update `package.json`

**Files:**
- Create: `scripts/mint-mock-token.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `mintMockTokens(tokenContract, signer, recipientAddress, amountStr)`, `checkTokenBalance(tokenContract, targetAddress)`, `parseCliArgs()`, `resolveMockTokenAddress()`.

- [ ] **Step 1: Create `scripts/mint-mock-token.ts`**

Implement CLI argument parsing, address resolution, `mintMockTokens`, `checkTokenBalance`, `printHelp`, and `main`.

- [ ] **Step 2: Update `package.json`**

Add `"mint-mock-token": "tsx scripts/mint-mock-token.ts"` to `scripts`.

- [ ] **Step 3: Verify compilation and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 4: Commit Task 1**

```bash
git add scripts/mint-mock-token.ts package.json
git commit -m "feat: implement mint-mock-token CLI script for MockERC20 tokens"
```

---

### Task 2: Implement Integration Tests & Update Deployment Guide

**Files:**
- Create: `test/MintMockTokenScript.ts`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Produces: Integration tests for minting and balance queries, and updated documentation.

- [x] **Step 1: Create `test/MintMockTokenScript.ts`**

Write integration tests validating argument parsing, mock token minting with decimal scaling, and balance queries.

- [x] **Step 2: Update `docs/Deployment Guide.md`**

Add Section 6 detailing how to mint mock tokens using `npm run mint-mock-token`.

- [x] **Step 3: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (239+ total tests).

- [x] **Step 4: Commit Task 2**

```bash
git add test/MintMockTokenScript.ts "docs/Deployment Guide.md"
git commit -m "test: add integration tests and documentation for mint-mock-token script"
```
