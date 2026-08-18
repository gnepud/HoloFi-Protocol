# View Card Script: Vault Lock Information Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `scripts/view-card.ts` to query `HoloFiVaultLoanCore` and display the Vault ID, Vault Owner (Store address), and Vault Status when inspecting a locked card NFT.

**Architecture:** Add `LOAN_CORE_ABI`, `VaultLockInfo` interface, `resolveLoanCoreAddress` helper, update `fetchCardDetails` to query `nftVaultId` and `getVault`, update `formatCardDetailsTable` and `main()`, add integration tests, and update documentation.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Ethers v6, Mocha, Chai, Node.js fs.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Vault Lock Queries in `scripts/view-card.ts`

**Files:**
- Modify: `scripts/view-card.ts`

**Interfaces:**
- Produces: `LOAN_CORE_ABI`, `VaultLockInfo`, `resolveLoanCoreAddress`, updated `fetchCardDetails`, `formatCardDetailsTable`, `parseCliArgs`, `printHelp`.

- [ ] **Step 1: Update `scripts/view-card.ts`**

Export `LOAN_CORE_ABI` and `VaultLockInfo`. Add `loanCoreAddress?: string;` and `vaultLockInfo?: VaultLockInfo;` to `CardDetails`. Implement `resolveLoanCoreAddress`. Update `fetchCardDetails`, `formatCardDetailsTable`, `parseCliArgs`, `printHelp`, and `main`.

- [ ] **Step 2: Verify compilation and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 3: Commit Task 1**

```bash
git add scripts/view-card.ts
git commit -m "feat: add vault lock and owner details for locked cards in view-card script"
```

---

### Task 2: Implement Integration Tests & Update Documentation

**Files:**
- Modify: `test/ViewCardScript.ts`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Produces: Unit and integration tests for locked card vault inspection and updated documentation.

- [ ] **Step 1: Update `test/ViewCardScript.ts`**

Add tests for `resolveLoanCoreAddress`, CLI `--loan-core` flag, and integration tests with `depositCollateral` to verify `vaultLockInfo` extraction (`vaultId`, `vaultOwner`, `vaultStatus`) and ASCII table rendering.

- [ ] **Step 2: Update `docs/Deployment Guide.md`**

Update Section 5 to document vault lock details and sample terminal outputs for locked cards.

- [ ] **Step 3: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (273+ total tests).

- [ ] **Step 4: Commit Task 2**

```bash
git add test/ViewCardScript.ts "docs/Deployment Guide.md"
git commit -m "test: add integration tests and documentation for vault lock info in view-card"
```
