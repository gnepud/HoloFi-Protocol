# Role Management Script Implementation Plan (`scripts/manage-roles.ts`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `scripts/manage-roles.ts` CLI tool allowing operators to view, grant, and revoke roles on `AccessControlManager.sol` via positional CLI arguments (`Mode A`).

**Architecture:** Build a standalone TypeScript script that parses positional CLI arguments (`check <address>`, `grant <address> <role>`, `revoke <address> <role>`), resolves `AccessControlManager` address (from args, env, or Ignition deployments), and executes the corresponding transactions or view queries. Add integration test and update deployment guide.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Ethers v6, Mocha, Chai, Node.js fs.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `scripts/manage-roles.ts`

**Files:**
- Create: `scripts/manage-roles.ts`

**Interfaces:**
- Produces: Executable CLI script for `npx hardhat run scripts/manage-roles.ts --network <network> -- <command>`.

- [ ] **Step 1: Create `scripts/manage-roles.ts`**

Implement argument parsing, role dictionary mapping, ACM address resolution, `checkRoles`, `grantRole`, `revokeRole`, and formatted ASCII table output.

- [ ] **Step 2: Verify compilation and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 3: Commit Task 1**

```bash
git add scripts/manage-roles.ts
git commit -m "feat: implement manage-roles CLI script for AccessControlManager"
```

---

### Task 2: Implement Integration Tests & Update Deployment Guide

**Files:**
- Create: `test/ManageRolesScript.ts`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Produces: Test coverage for script functions and updated documentation.

- [ ] **Step 1: Create `test/ManageRolesScript.ts`**

Write integration tests validating the role checking, role granting, and role revoking logic against deployed `AccessControlManager`.

- [ ] **Step 2: Update `docs/Deployment Guide.md`**

Add a dedicated Section 4 detailing the role management CLI script usage, command examples, and supported role aliases.

- [ ] **Step 3: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (177+ total tests).

- [ ] **Step 4: Commit Task 2**

```bash
git add test/ManageRolesScript.ts "docs/Deployment Guide.md"
git commit -m "test: add integration test and documentation for manage-roles script"
```
