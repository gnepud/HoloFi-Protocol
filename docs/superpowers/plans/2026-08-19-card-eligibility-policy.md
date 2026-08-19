# Card Eligibility Policy Engine & Collateral Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pluggable `ICardEligibilityPolicy` architecture and `GradeEligibilityPolicy` contract, integrate collateral eligibility checks into `HoloFiLendingPool` and `HoloFiVaultLoanCore`, and wire the PSA 10 policy to the default Premium Pool in Hardhat Ignition.

**Architecture:** A strategy-pattern policy engine where `HoloFiLendingPool` references an optional `ICardEligibilityPolicy`. `GradeEligibilityPolicy` accepts 8 canonical card attributes, parses integer grades, filters by grader and grade bounds (`minGrade`/`maxGrade`), and whitelists eligible `cardTypeId` hashes via `MINTER_ROLE`. `HoloFiVaultLoanCore.depositCollateral` enforces that all deposited cards are permitted by the vault's bound lending pool.

**Tech Stack:** Solidity ^0.8.28, Hardhat 3, OpenZeppelin Contracts v5, Ethers v6, Mocha, Chai, Hardhat Ignition.

**Spec:** [`docs/superpowers/specs/2026-08-19-card-eligibility-policy-design.md`](file:///Users/gnepud/projects/holofi/holofi_protocol/docs/superpowers/specs/2026-08-19-card-eligibility-policy-design.md)

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task
- Adhere to Linear integration commit convention `[Magic Word] [TEAM-123]` (Linear issue: HF-38)

---

### Task 1: Policy Interface, `GradeEligibilityPolicy` Contract & Solidity Unit Tests

**Files:**
- Create: `contracts/interfaces/ICardEligibilityPolicy.sol`
- Create: `contracts/policies/GradeEligibilityPolicy.sol`
- Create: `contracts/policies/GradeEligibilityPolicy.t.sol`

**Interfaces:**
- Produces:
  - `ICardEligibilityPolicy`: `struct CardAttributes`, `computeCardTypeId`, `registerCardType`, `isCardTypeEligible`, `CardTypeRegistered`, `CardTypeOverrideUpdated`.
  - `GradeEligibilityPolicy`: `parseGrade(string)`, `computeCardTypeId(CardAttributes)`, `registerCardType(CardAttributes)`, `setCardTypeOverride(bytes32, bool)`, `isCardTypeEligible(bytes32)`, `onlyMinter` access control, `UnauthorizedMinter` error.

- [x] **Step 1: Create `contracts/interfaces/ICardEligibilityPolicy.sol`**

Define `CardAttributes` struct with 8 string fields (`game`, `language`, `setName`, `cardName`, `cardNumber`, `printing`, `grader`, `grade`), events `CardTypeRegistered` and `CardTypeOverrideUpdated`, and function interfaces `computeCardTypeId`, `registerCardType`, `isCardTypeEligible`.

- [x] **Step 2: Create `contracts/policies/GradeEligibilityPolicy.sol`**

Implement `GradeEligibilityPolicy` with `AccessControlManager`, `requiredGrader`, `minGrade`, `maxGrade`, `parseGrade`, `computeCardTypeId` using `abi.encode`, `registerCardType` with `onlyMinter`, `setCardTypeOverride` with `onlyMinter`, and `isCardTypeEligible`.

- [x] **Step 3: Create `contracts/policies/GradeEligibilityPolicy.t.sol`**

Write Solidity unit tests:
- Test `parseGrade`: `"10"` $\rightarrow$ 10, `"9"` $\rightarrow$ 9, `"8"` $\rightarrow$ 8, `""` $\rightarrow$ 0.
- Test `computeCardTypeId`: matches expected `keccak256(abi.encode(...))` hash.
- Test `registerCardType`:
  - PSA 10 card on $\ge 10$ policy registers `isEligible = true` and emits `CardTypeRegistered`.
  - PSA 9 card on $\ge 10$ policy returns `eligible = false` and leaves `isEligible = false`.
  - PSA 9 card on $\le 9$ policy registers `isEligible = true`.
  - BGS 10 card on PSA policy returns `eligible = false`.
- Test `setCardTypeOverride`: allows minter to manually update whitelist status.
- Test `UnauthorizedMinter` revert when non-minter calls `registerCardType` or `setCardTypeOverride`.
- Test constructor zero address ACM revert.

- [x] **Step 4: Run Solidity unit tests to verify**

Run: `npx hardhat test solidity`
Expected: PASS cleanly.

- [x] **Step 5: Commit Task 1**

```bash
git add contracts/interfaces/ contracts/policies/
git commit -m "feat(HF-38): add ICardEligibilityPolicy and GradeEligibilityPolicy contract (relates to HF-38)"
```

---

### Task 2: Integrate Policy Engine into `HoloFiLendingPool` and `HoloFiVaultLoanCore`

**Files:**
- Modify: `contracts/HoloFiLendingPool.sol`
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiLendingPool.t.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Consumes: `ICardEligibilityPolicy` from Task 1.
- Produces:
  - `HoloFiLendingPool`: `eligibilityPolicy`, `setEligibilityPolicy(address)`, `isCollateralAllowed(bytes32)`.
  - `HoloFiVaultLoanCore`: `IneligibleCollateral(uint256, bytes32, address)` error, enforced in `depositCollateral`.

- [x] **Step 1: Update `contracts/HoloFiLendingPool.sol`**

Add `address public eligibilityPolicy;`, `event EligibilityPolicyUpdated(address indexed newPolicy);`, `setEligibilityPolicy(address _policy)` with `onlyAdmin`, and `isCollateralAllowed(bytes32 cardTypeId)` (returns `true` if `eligibilityPolicy == address(0)`, else calls `policy.isCardTypeEligible(cardTypeId)`).

- [x] **Step 2: Update `contracts/HoloFiVaultLoanCore.sol`**

Add `error IneligibleCollateral(uint256 tokenId, bytes32 cardTypeId, address lendingPool);`. In `depositCollateral(vaultId, tokenIds)`, query `HoloFiLendingPool(vault.lendingPool).isCollateralAllowed(card.cardTypeId)` and revert with `IneligibleCollateral` if disallowed.

- [x] **Step 3: Update `contracts/HoloFiLendingPool.t.sol` and `contracts/HoloFiVaultLoanCore.t.sol`**

Add tests for:
- `HoloFiLendingPool.t.sol`: `setEligibilityPolicy` success by admin, unauthorized caller revert, `isCollateralAllowed` with zero address and active policy.
- `HoloFiVaultLoanCore.t.sol`: `depositCollateral` succeeds with eligible card and reverts with `IneligibleCollateral` with ineligible card.

- [x] **Step 4: Run Solidity unit tests to verify**

Run: `npx hardhat test solidity`
Expected: PASS cleanly.

- [x] **Step 5: Commit Task 2**

```bash
git add contracts/HoloFiLendingPool.sol contracts/HoloFiVaultLoanCore.sol contracts/HoloFiLendingPool.t.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-38): integrate card eligibility policy in HoloFiLendingPool and HoloFiVaultLoanCore (relates to HF-38)"
```

---

### Task 3: Ignition Modules, TypeScript Integration Tests & Documentation

**Files:**
- Modify: `ignition/modules/DeployHoloFiLendingPoolWithMock.ts`
- Modify: `test/HoloFiLendingPool.ts`
- Modify: `test/HoloFiVaultLoanCore.ts`
- Modify: `test/DeployHoloFiProtocol.ts`
- Modify: `docs/System Architecture Document.md`
- Modify: `docs/Deployment Guide.md`

**Interfaces:**
- Consumes: `GradeEligibilityPolicy`, `HoloFiLendingPool.eligibilityPolicy`, `HoloFiVaultLoanCore.IneligibleCollateral`.
- Produces: Updated Ignition deployment with PSA 10 policy on Premium Pool, TypeScript integration tests, and updated documentation.

- [x] **Step 1: Update `ignition/modules/DeployHoloFiLendingPoolWithMock.ts`**

Deploy `GradeEligibilityPolicy(acm, "PSA", 10n, 0n)` as `premiumPoolPolicy` and call `premiumLendingPool.setEligibilityPolicy(premiumPoolPolicy)`. Deploy `GradeEligibilityPolicy(acm, "PSA", 0n, 9n)` as `deluxePoolPolicy` and call `deluxeLendingPool.setEligibilityPolicy(deluxePoolPolicy)`.

- [x] **Step 2: Update TypeScript Integration Tests**

Add integration tests:
- `test/HoloFiLendingPool.ts`: Test `setEligibilityPolicy` and `isCollateralAllowed` with mock policy.
- `test/HoloFiVaultLoanCore.ts`: End-to-end test with `GradeEligibilityPolicy`:
  - Mint PSA 10 card and register in policy -> deposit into Premium Pool vault succeeds, deposit into Deluxe Pool vault reverts with `IneligibleCollateral`.
  - Mint PSA 9 card and register in policy -> deposit into Deluxe Pool vault succeeds, deposit into Premium Pool vault reverts with `IneligibleCollateral`.
- `test/DeployHoloFiProtocol.ts`: Verify `DeployHoloFiLendingPoolWithMock` deploys policies and wires `premiumLendingPool.eligibilityPolicy()` and `deluxeLendingPool.eligibilityPolicy()`.

- [x] **Step 3: Update `docs/System Architecture Document.md` and `docs/Deployment Guide.md`**

Document the `ICardEligibilityPolicy` architecture, `GradeEligibilityPolicy`, `isCollateralAllowed` validation flow, and deployment configurations.

- [x] **Step 4: Run full verification suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (all 290+ tests pass with 0 errors).

- [x] **Step 5: Commit Task 3**

```bash
git add ignition/ test/ docs/
git commit -m "test(HF-38): add integration tests, ignition policy wiring, and docs for card eligibility policy (relates to HF-38)"
```
