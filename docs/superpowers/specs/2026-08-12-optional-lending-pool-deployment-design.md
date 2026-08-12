# Optional `HoloFiLendingPool` Hardhat Ignition Deployment Specification

- **Feature**: HF-48 — Optional `HoloFiLendingPool` Deployment Module (`Hardhat Ignition`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-12
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines the extension of the Hardhat Ignition deployment suite for HoloFi protocol to support flexible, optional `HoloFiLendingPool` deployment. Deployers can choose via parameters whether to deploy a pool with a `MockERC20` contract pre-funded with initial liquidity (e.g., 1,000,000 EURC), or deploy a pool referencing an existing ERC-20 contract address.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Core Protocol Module**: `ignition/modules/DeployHoloFiProtocol.ts`
* **Lending Pool Submodule**: `ignition/modules/DeployHoloFiLendingPool.ts`
* **Full Protocol Composite Module**: `ignition/modules/DeployHoloFiFullProtocol.ts`
* **Verification Test Suite**: `test/DeployHoloFiProtocol.ts`

---

### 2.2 Ignition Module Architecture

#### 1. `ignition/modules/DeployHoloFiLendingPool.ts`
Submodule that deploys a pool given an `acm`, `poolFactory`, and `loanCore` contract reference:

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

  // Determine underlying asset
  let assetAddress;
  let mockAsset;

  if (useMockToken) {
    mockAsset = m.contract("MockERC20", ["Euro Coin", "EURC", 6]);
    assetAddress = mockAsset;
  } else {
    assetAddress = m.getParameter("existingAssetAddress");
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

#### 2. `ignition/modules/DeployHoloFiFullProtocol.ts`
Unified composite module for full protocol + optional pool deployment:

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

---

## 3. Testing & Verification Strategy

### 3.1 Verification Test Suite (`test/DeployHoloFiProtocol.ts`)
1. **Mock Token Scenario (`useMockToken: true`)**:
   - Deploy via `ignition.deploy(DeployHoloFiFullProtocol, { parameters: { DeployHoloFiLendingPool: { useMockToken: true, mockMintAmount: 1000000000000n } } })`.
   - Assert `mockAsset` deployed.
   - Assert `poolFactory.isValidPool(lendingPoolAddress) == true`.
   - Assert `lendingPool.loanCore() == loanCoreAddress`.
   - Assert `mockAsset.balanceOf(lendingPoolAddress) == 1_000_000_000_000n` (1,000,000 EURC).

2. **Existing Asset Scenario (`useMockToken: false`)**:
   - Deploy standalone `MockERC20` asset.
   - Deploy via `ignition.deploy(DeployHoloFiFullProtocol, { parameters: { DeployHoloFiLendingPool: { useMockToken: false, existingAssetAddress: assetAddr } } })`.
   - Assert `poolFactory.getPool(assetAddr) == lendingPoolAddress`.
   - Assert `lendingPool.loanCore() == loanCoreAddress`.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 158+ tests passing)
