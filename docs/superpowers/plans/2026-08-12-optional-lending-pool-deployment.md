# Optional `HoloFiLendingPool` Hardhat Ignition Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement flexible Ignition deployment modules (`DeployHoloFiLendingPool.ts` and `DeployHoloFiFullProtocol.ts`) allowing deployers to choose whether to deploy a pool with `MockERC20` (and pre-funded liquidity) or a pre-existing ERC20 token address.

**Architecture:** Define `ignition/modules/DeployHoloFiLendingPool.ts` taking parameters `useMockToken`, `existingAssetAddress`, `mockMintAmount`, `poolName`, `poolSymbol`. Create composite module `ignition/modules/DeployHoloFiFullProtocol.ts`. Add automated verification test scenarios in `test/DeployHoloFiProtocol.ts`.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, Hardhat Ignition (`@nomicfoundation/hardhat-ignition`), Ethers v6, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Create Ignition Modules `DeployHoloFiLendingPool.ts` and `DeployHoloFiFullProtocol.ts`

**Files:**
- Create: `ignition/modules/DeployHoloFiLendingPool.ts`
- Create: `ignition/modules/DeployHoloFiFullProtocol.ts`

**Interfaces:**
- Produces: `DeployHoloFiLendingPool` and `DeployHoloFiFullProtocol` Ignition modules.

- [ ] **Step 1: Create `ignition/modules/DeployHoloFiLendingPool.ts`**

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";

const DeployHoloFiLendingPool = buildModule("DeployHoloFiLendingPool", (m) => {
  const { acm, poolFactory, loanCore } = m.useModule(DeployHoloFiProtocol);

  const useMockToken = m.getParameter("useMockToken", true);
  const existingAssetAddress = m.getParameter("existingAssetAddress", "");
  const mockMintAmount = m.getParameter("mockMintAmount", 1_000_000_000_000n); // 1,000,000 EURC (6 decimals)
  const poolName = m.getParameter("poolName", "Pool EURC");
  const poolSymbol = m.getParameter("poolSymbol", "pEURC");

  let assetAddress;
  let mockAsset;

  if (useMockToken) {
    mockAsset = m.contract("MockERC20", ["Euro Coin", "EURC", 6]);
    assetAddress = mockAsset;
  } else {
    assetAddress = existingAssetAddress;
  }

  // Create pool via factory
  const createPoolTx = m.call(poolFactory, "createPool", [
    assetAddress,
    poolName,
    poolSymbol,
  ]);

  // Query deployed pool address
  const poolAddress = m.staticCall(poolFactory, "getPool", [assetAddress], {
    after: [createPoolTx],
  });

  // Bind contract instance
  const lendingPool = m.contractAt("HoloFiLendingPool", poolAddress);

  // Set loanCore in lendingPool
  m.call(lendingPool, "setLoanCore", [loanCore]);

  // Mint mock liquidity if mock token used
  if (useMockToken && mockAsset) {
    m.call(mockAsset, "mint", [poolAddress, mockMintAmount]);
  }

  return {
    lendingPool,
    assetAddress,
    mockAsset,
  };
});

export default DeployHoloFiLendingPool;
```

- [ ] **Step 2: Create `ignition/modules/DeployHoloFiFullProtocol.ts`**

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployHoloFiProtocol from "./DeployHoloFiProtocol.js";
import DeployHoloFiLendingPool from "./DeployHoloFiLendingPool.js";

const DeployHoloFiFullProtocol = buildModule("DeployHoloFiFullProtocol", (m) => {
  const protocol = m.useModule(DeployHoloFiProtocol);
  const deployPool = m.getParameter("deployPool", true);

  let poolModule;
  if (deployPool) {
    poolModule = m.useModule(DeployHoloFiLendingPool);
  }

  return {
    ...protocol,
    lendingPool: poolModule?.lendingPool,
    mockAsset: poolModule?.mockAsset,
  };
});

export default DeployHoloFiFullProtocol;
```

- [ ] **Step 3: Verify build and typecheck**

Run: `npx hardhat build && npx tsc --noEmit`
Expected: PASS cleanly.

- [ ] **Step 4: Commit Task 1**

```bash
git add ignition/modules/
git commit -m "feat(HF-48): add optional HoloFiLendingPool Hardhat Ignition deployment modules (relates to HF-48)"
```

---

### Task 2: Implement Test Verification Scenarios (`test/DeployHoloFiProtocol.ts`)

**Files:**
- Modify: `test/DeployHoloFiProtocol.ts`

**Interfaces:**
- Produces: Test verification for MockERC20 pool deployment with 1M EURC liquidity and existing asset pool deployment.

- [ ] **Step 1: Update `test/DeployHoloFiProtocol.ts`**

Add test cases for:
1. `DeployHoloFiFullProtocol` with `useMockToken: true` $\rightarrow$ verifies `MockERC20` deployment, pool registration, `loanCore` setting, and 1,000,000 EURC pool balance.
2. `DeployHoloFiFullProtocol` with `useMockToken: false` and `existingAssetAddress` $\rightarrow$ verifies pool creation for existing ERC20 asset.

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (160+ total tests).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/DeployHoloFiProtocol.ts
git commit -m "test(HF-48): add verification test cases for optional lending pool deployment (Fixes HF-48)"
```
