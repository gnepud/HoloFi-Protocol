# Variable Standardization for `HoloFiVaultCard` Contract Specification

- **Feature**: HF-37 (Extension) — Variable Standardization for `HoloFiVaultCard` Contract
- **Status**: Draft / Approved Design
- **Date**: 2026-08-04
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This refactoring standardizes state variables, constructor parameters, custom errors, and test fixture variables referencing `HoloFiVaultCard` across smart contracts, unit/integration test suites, and documentation.

---

## 2. Technical Specification

### 2.1 Smart Contract Variable Updates (`contracts/HoloFiVaultLoanCore.sol`)

```solidity
// State variable
HoloFiVaultCard public immutable vaultCard;

// Custom error
error ZeroAddressVaultCard();

// Constructor
constructor(address _acm, address _vaultCard, address _poolFactory) {
    if (_acm == address(0)) revert ZeroAddressACM();
    if (_vaultCard == address(0)) revert ZeroAddressVaultCard();
    if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();
    acm = AccessControlManager(_acm);
    vaultCard = HoloFiVaultCard(_vaultCard);
    poolFactory = HoloFiLendingPoolFactory(_poolFactory);
}
```

### 2.2 Test Suite Variable Updates
* **Solidity Tests (`contracts/*.t.sol`)**:
  - Rename `cardCollection` state/local variables to `vaultCard`.
  - Update `loanCore.vaultCard()`.
  - Update `ZeroAddressVaultCard` error selector expectations.
* **TypeScript Tests (`test/*.ts`)**:
  - Rename `cardCollection` variables in `deployFixture` and test cases to `vaultCard`.

### 2.3 Documentation Updates
* Update `docs/System Architecture Document.md` references from `nftCollection` / `ZeroAddressNFT` to `vaultCard` / `ZeroAddressVaultCard`.

---

## 3. Testing & Verification

- Run full compilation: `npx hardhat build`
- Run TypeScript check: `npx tsc --noEmit`
- Run complete test suite: `npx hardhat test` (All 139+ tests passing)
