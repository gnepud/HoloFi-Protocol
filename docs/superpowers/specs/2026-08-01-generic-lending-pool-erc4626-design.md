# Generic ERC-4626 Lending Pool (`HoloFiLendingPool`) Specification

- **Feature**: HF-15 — Generic ERC-4626 Lending Pool (`HoloFiLendingPool`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-01
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiLendingPool` smart contract is a generic, permissioned ERC-4626 yield-bearing liquidity pool. It accepts single-asset deposits for any standard ERC-20 token (such as USDC, EURC, USDT, or WETH) and issues corresponding yield-bearing liquidity tokens (`pTokens`) to Liquidity Providers (LPs).

It serves as a modular liquidity pool for the HoloFi credit engine, enabling registered loan core contracts (`HoloFiVaultLoanCore`) to draw funds for store borrowing and accept repaid principal + accrued interest.

---

## 2. Technical Specification

### 2.1 File Location & Dependencies
* **Contract File**: `contracts/HoloFiLendingPool.sol`
* **Mock Asset File**: `contracts/mocks/MockERC20.sol`
* **Base Contracts**: `@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`

### 2.2 On-Chain Data Model & State Variables

```solidity
AccessControlManager public immutable acm;
address public loanCore;

event LoanCoreUpdated(address indexed newLoanCore);
event LiquidityDrawn(address indexed borrower, uint256 amount);
event LiquidityReturned(address indexed payer, uint256 amount);
```

### 2.3 Custom Errors
* `ZeroAddressAsset()`: Constructor called with `address(0)` for asset.
* `ZeroAddressACM()`: Constructor called with `address(0)` for `_acm`.
* `ZeroAddressLoanCore()`: `setLoanCore` called with `address(0)`.
* `UnauthorizedAdmin(address caller)`: `setLoanCore` called by non-admin.
* `UnauthorizedLoanCore(address caller)`: `drawLiquidity` or `returnLiquidity` called by non-loanCore and non-admin.
* `InsufficientVaultLiquidity(uint256 available, uint256 required)`: Attempting to draw more liquidity than pool's underlying asset balance.

### 2.4 Functions

#### `constructor(IERC20 asset_, string memory name_, string memory symbol_, address _acm)`
- Reverts `ZeroAddressAsset()` if `address(asset_) == address(0)`.
- Reverts `ZeroAddressACM()` if `_acm == address(0)`.
- Initializes `ERC4626(asset_)` and `ERC20(name_, symbol_)`.
- Sets `acm = AccessControlManager(_acm)`.

#### `setLoanCore(address _loanCore) external`
- Validation: Reverts `UnauthorizedAdmin(msg.sender)` if caller lacks `ADMIN_ROLE` in `acm`.
- Reverts `ZeroAddressLoanCore()` if `_loanCore == address(0)`.
- State Change: Sets `loanCore = _loanCore`.
- Event: Emits `LoanCoreUpdated(_loanCore)`.

#### `drawLiquidity(address recipient, uint256 amount) external`
- Validation:
  - Reverts `UnauthorizedLoanCore(msg.sender)` if `msg.sender != loanCore` and `!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)`.
  - Reverts `InsufficientVaultLiquidity(available, amount)` if `IERC20(asset()).balanceOf(address(this)) < amount`.
- Logic:
  - Transfers `amount` of underlying asset to `recipient`.
  - Emits `LiquidityDrawn(recipient, amount)`.

#### `returnLiquidity(address payer, uint256 amount) external`
- Validation:
  - Reverts `UnauthorizedLoanCore(msg.sender)` if `msg.sender != loanCore` and `!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)`.
- Logic:
  - Pulls `amount` of underlying asset from `payer` into `address(this)` via `IERC20(asset()).transferFrom(payer, address(this), amount)`.
  - Emits `LiquidityReturned(payer, amount)`.

---

## 3. Testing Strategy

### 3.1 Mock ERC-20 Contract (`contracts/mocks/MockERC20.sol`)
Implement generic `MockERC20` with configurable `name`, `symbol`, and `decimals` (supporting 6-decimal and 18-decimal configurations) and a `mint(address to, uint256 amount)` function.

### 3.2 Solidity Unit Tests (`contracts/HoloFiLendingPool.t.sol`)
1. `test_Constructor_InitialState`: Verify asset, ACM address, custom name/symbol across 6-decimal and 18-decimal pools.
2. `test_DepositAndRedeem_6Decimals`: Verify deposit and redeem exchange rates for 6-decimal underlying asset (e.g. EURC/USDC).
3. `test_DepositAndRedeem_18Decimals`: Verify deposit and redeem exchange rates for 18-decimal underlying asset (e.g. WETH).
4. `test_SetLoanCore_Success`: Verify admin can set `loanCore` address.
5. `test_DrawLiquidity_Success`: Verify `loanCore` can draw liquidity for a borrower.
6. `test_RevertIf_InsufficientVaultLiquidity`: Verify `drawLiquidity` reverts when requesting more funds than available.
7. `test_ReturnLiquidity_Success`: Verify `loanCore` can return liquidity from a repayer.

### 3.3 TypeScript Integration Tests (`test/HoloFiLendingPool.ts`)
1. Deploy `MockERC20` (6 decimals & 18 decimals), `AccessControlManager`, and `HoloFiLendingPool`.
2. Mint mock tokens to LPs, approve pool, and perform `deposit`.
3. Verify share tokens minted to LP.
4. Register fake `loanCore`, execute `drawLiquidity` and `returnLiquidity`.
5. LP performs `redeem` and verifies final underlying token balance.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
