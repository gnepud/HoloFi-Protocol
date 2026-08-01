# KYB Whitelist Registry Specification

- **Feature**: HF-11 — Implement KYB Whitelist Registry
- **Status**: Draft / Approved Design
- **Date**: 2026-07-31
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The KYB (Know Your Business) Whitelist Registry tracks verified store wallets permitted to participate in the HoloFi credit protocol (minting/holding collateral NFTs, depositing into the ERC-4626 lending vault, borrowing against vaults).

This feature extends `AccessControlManager.sol` to provide on-chain KYB status storage, single and batch update capabilities, event logging, and access control enforced via `KYB_MANAGER_ROLE` and `ADMIN_ROLE`.

---

## 2. Technical Specification

### 2.1 Storage & State Variables
* `mapping(address => bool) public isKybApproved`: Mapping tracking KYB approval status for wallet addresses.

### 2.2 Events
* `event KybStatusUpdated(address indexed account, bool status, address indexed operator)`: Emitted whenever an address's KYB status is set or updated.

### 2.3 Custom Errors
* `ZeroAddressKybAccount()`: Reverts when attempting to set KYB status for `address(0)`.
* `UnauthorizedKybOperator(address operator)`: Reverts when a caller without `KYB_MANAGER_ROLE` or `ADMIN_ROLE` attempts to manage KYB status.

### 2.4 Management Functions

#### `setKybStatus(address account, bool status)`
- **Access**: Restricted to callers possessing `KYB_MANAGER_ROLE` or `ADMIN_ROLE`.
- **Validation**: Reverts with `ZeroAddressKybAccount()` if `account == address(0)`.
- **State Change**: Sets `isKybApproved[account] = status`.
- **Event**: Emits `KybStatusUpdated(account, status, msg.sender)`.

#### `setKybStatusBatch(address[] calldata accounts, bool status)`
- **Access**: Restricted to callers possessing `KYB_MANAGER_ROLE` or `ADMIN_ROLE`.
- **Logic**: Iterates over `accounts` array, validating `account != address(0)` and setting `isKybApproved[account] = status`, emitting `KybStatusUpdated` for each.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/AccessControlManager.t.sol`)
1. `test_SetKybStatus_Success`: Verify `KYB_MANAGER_ROLE` holder can approve and revoke KYB status for an account, checking state change and event.
2. `test_SetKybStatus_AdminSuccess`: Verify `ADMIN_ROLE` holder can also update KYB status.
3. `test_SetKybStatusBatch_Success`: Verify batch approval for multiple addresses.
4. `test_RevertIf_ZeroAddressKybAccount`: Verify `setKybStatus(address(0), true)` reverts with `ZeroAddressKybAccount()`.
5. `test_RevertIf_UnauthorizedKybManager`: Verify unauthorized account caller reverts when calling `setKybStatus`.

### 3.2 TypeScript Integration Tests (`test/AccessControlManager.ts`)
1. Test `setKybStatus` and `setKybStatusBatch` from `kybManager` signer with `to.emit(acm, "KybStatusUpdated")`.
2. Test query `isKybApproved(address)`.
3. Test custom error reversion for unauthorized caller and zero address.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
