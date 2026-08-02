# LendingPool Registry & Verification Guard Specification

- **Feature**: HF-32 — LendingPool Registry & Verification Guard (`HoloFiLendingPoolFactory` & `HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-02
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature establishes an on-chain pool verification boundary to prevent fake or malicious lending pool contract injection during credit execution (`borrow`) and debt settlement (`repay`) in `HoloFiVaultLoanCore`.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Contracts**: `contracts/HoloFiLendingPoolFactory.sol`, `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiLendingPool.sol`

### 2.2 Factory Registry Tracking (`HoloFiLendingPoolFactory.sol`)

```solidity
mapping(address => bool) public isValidPool;

function createPool(
    IERC20 asset,
    string calldata name,
    string calldata symbol
) external returns (address pool) {
    ...
    HoloFiLendingPool poolContract = new HoloFiLendingPool(asset, name, symbol, address(acm));
    pool = address(poolContract);

    getPool[address(asset)] = pool;
    isValidPool[pool] = true;
    allPools.push(pool);
    ...
}
```

### 2.3 LoanCore Security Guard (`HoloFiVaultLoanCore.sol`)

```solidity
HoloFiLendingPoolFactory public immutable poolFactory;

error ZeroAddressPoolFactory();
error UnregisteredLendingPool(address pool);

constructor(address _acm, address _nftCollection, address _poolFactory) {
    if (_acm == address(0)) revert ZeroAddressACM();
    if (_nftCollection == address(0)) revert ZeroAddressNFT();
    if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();

    acm = AccessControlManager(_acm);
    nftCollection = HoloFiCardCollection(_nftCollection);
    poolFactory = HoloFiLendingPoolFactory(_poolFactory);
}

function borrow(uint256 vaultId, uint256 amount, address lendingPool) external {
    if (!poolFactory.isValidPool(lendingPool)) {
        revert UnregisteredLendingPool(lendingPool);
    }
    ...
}

function repay(uint256 vaultId, uint256 amount, address lendingPool) external {
    if (!poolFactory.isValidPool(lendingPool)) {
        revert UnregisteredLendingPool(lendingPool);
    }
    ...
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests
* **Factory Tests (`contracts/HoloFiLendingPoolFactory.t.sol`)**:
  1. `test_CreatePool_SetsIsValidPool`: Verify `isValidPool(pool) == true` after `createPool()`.
  2. `test_IsValidPool_UnregisteredPool`: Verify `isValidPool(randomAddress) == false`.
* **LoanCore Tests (`contracts/HoloFiVaultLoanCore.t.sol`)**:
  1. `test_RevertIf_Constructor_ZeroAddressPoolFactory`: Passing `address(0)` for `poolFactory` reverts `ZeroAddressPoolFactory`.
  2. `test_RevertIf_Borrow_UnregisteredLendingPool`: Calling `borrow()` with a fake or unregistered pool address reverts `UnregisteredLendingPool`.
  3. `test_RevertIf_Repay_UnregisteredLendingPool`: Calling `repay()` with an unregistered pool address reverts `UnregisteredLendingPool`.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)
* Store creates vault, deposits collateral.
* Store attempts to borrow from a mock fake pool -> reverts `UnregisteredLendingPool`.
* Admin deploys pool via `HoloFiLendingPoolFactory.createPool()`.
* Store borrows and repays using the factory-deployed pool -> succeeds cleanly.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
