# KYC/KYB Status Management Implementation Plan (`scripts/manage-roles.ts`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `scripts/manage-roles.ts` to support modifying KYC/KYB compliance status for any specified wallet address on `AccessControlManager.sol`.

**Architecture:** Add `parseBooleanStatus` and `setKybStatus` helpers in `scripts/manage-roles.ts`. Support `kyb` and `kyc` actions with flexible status aliases (`true`/`false`/`approve`/`reject`), check authorization (`KYB_MANAGER_ROLE` or `ADMIN_ROLE`), execute transaction, and display updated status. Add integration tests and update documentation.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Ethers v6, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `setKybStatus` in `scripts/manage-roles.ts`

**Files:**
- Modify: `scripts/manage-roles.ts`

**Interfaces:**
- Produces: `setKybStatus(acm, signer, targetAddress, status)` and `parseBooleanStatus(input)`.

- [ ] **Step 1: Update `scripts/manage-roles.ts`**

Add `statusValue` to `ParsedCliArgs`. Implement `parseBooleanStatus`, `setKybStatus`, update `parseCliArgs`, `main`, and `printHelp`.

- [ ] **Step 2: Verify compilation and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 3: Commit Task 1**

```bash
git add scripts/manage-roles.ts
git commit -m "feat: add KYC/KYB status update action in manage-roles script"
```

---

### Task 2: Implement Integration Tests & Update Documentation

**Files:**
- Modify: `test/ManageRolesScript.ts`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Produces: Test coverage for `setKybStatus` and updated deployment documentation.

- [ ] **Step 1: Update `test/ManageRolesScript.ts`**

Add integration tests for `parseBooleanStatus`, `parseCliArgs` with `kyb`/`kyc`, and `setKybStatus` execution (approving, revoking, idempotency, permission guards).

- [ ] **Step 2: Update `docs/Deployment Guide.md`**

Update Section 4 to include `kyb` / `kyc` actions, status value aliases, and CLI examples.

- [ ] **Step 3: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (200+ total tests).

- [ ] **Step 4: Commit Task 2**

```bash
git add test/ManageRolesScript.ts "docs/Deployment Guide.md"
git commit -m "test: add integration tests and docs for KYC/KYB status management"
```
