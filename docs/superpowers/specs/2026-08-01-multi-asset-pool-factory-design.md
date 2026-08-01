# Multi-Asset Pool Factory (`HoloFiLendingPoolFactory`) Specification

- **Feature**: HF-30 — Multi-Asset Pool Factory (`HoloFiLendingPoolFactory`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-01
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiLendingPoolFactory` smart contract provides a centralized, permissioned factory for deploying and registering `HoloFiLendingPool` instances for supported underlying ERC-20 assets (e.g. USDC, EURC, USDT, WETH).

It enforces role authorization (`ADMIN_ROLE` or `ORACLE_ROLE` in `AccessControlManager`), prevents duplicate pool creation per underlying asset, maintains an on-chain registry mapping `underlyingAsset => poolAddress`, and tracks all deployed pool addresses in an array.

---

## 2. Technical Specification

### 2.1 File Location & Dependencies
* **Factory File**: `contracts/HoloFiLendingPoolFactory.sol`
* **Target Pool File**: `contracts/HoloFiLendingPool.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`

### 2.2 On-Chain Data Model & State Variables

```solidity
AccessControlManager public immutable acm;
mapping(address => address) public getPool;
address[] public allPools;

event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);
```

### 2.3 Custom Errors
* `ZeroAddressACM()`: Constructor called with `address(0)` for `_acm`.
* `ZeroAddressAsset()`: `createPool` called with `address(0)` for `asset`.
* `PoolAlreadyExists(address underlyingAsset, address existingPool)`: `createPool` called for an asset that already has a registered pool.
* `UnauthorizedOperator(address caller)`: `createPool` called by account lacking `ADMIN_ROLE` and `ORACLE_ROLE`.

### 2.4 Functions

#### `constructor(address _acm)`
- Reverts `ZeroAddressACM()` if `_acm == address(0)`.
- Sets `acm = AccessControlManager(_acm)`.

#### `createPool(IERC20 asset, string calldata name, string calldata symbol) external returns (address pool)`
- **Access Control**: Reverts `UnauthorizedOperator(msg.sender)` if caller lacks `acm.ADMIN_ROLE()` and `acm.ORACLE_ROLE()`.
- **Validation**:
  - Reverts `ZeroAddressAsset()` if `address(asset) == address(0)`.
  - Reverts `PoolAlreadyExists(address(asset), getPool[address(asset)])` if `getPool[address(asset)] != address(0)`.
- **Logic**:
  1. Deploys new `HoloFiLendingPool` instance: `new HoloFiLendingPool(asset, name, symbol, address(acm))`.
  2. Registers `getPool[address(asset)] = address(newPool)`.
  3. Pushes `address(newPool)` to `allPools`.
  4. Emits `PoolCreated(address(asset), address(newPool), name, symbol)`.
  5. Returns `address(newPool)`.

#### `allPoolsLength() external view returns (uint256)`
- Returns `allPools.length`.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiLendingPoolFactory.t.sol`)
1. `test_Constructor_InitialState`: Verify ACM address set correctly.
2. `test_CreatePool_AdminSuccess`: Admin deploys pool for EURC, verifying registry mapping `getPool[address(eurc)]`, `allPools[0]`, and `PoolCreated` event emission.
3. `test_CreatePool_OracleSuccess`: Oracle deploys pool for WETH, verifying `getPool[address(weth)]`.
4. `test_RevertIf_UnauthorizedCreatePool`: Non-admin and non-oracle caller reverts `UnauthorizedOperator`.
5. `test_RevertIf_CreatePool_ZeroAddressAsset`: Calling `createPool` with zero address asset reverts `ZeroAddressAsset`.
6. `test_RevertIf_CreatePool_AlreadyExists`: Creating a second pool for the same underlying asset reverts `PoolAlreadyExists`.

### 3.2 TypeScript Integration Tests (`test/HoloFiLendingPoolFactory.ts`)
1. Deploy `AccessControlManager` and `HoloFiLendingPoolFactory`.
2. Grant `ORACLE_ROLE` to an oracle signer.
3. Deploy EURC pool via factory, verify `getPool` lookup and `allPools` array length.
4. Attempt duplicate deployment for EURC, verify revert `PoolAlreadyExists`.
5. Attempt unauthorized pool creation, verify revert `UnauthorizedOperator`.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
