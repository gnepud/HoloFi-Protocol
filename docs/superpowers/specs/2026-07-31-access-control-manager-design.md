# AccessControlManager Smart Contract Specification

- **Feature**: HF-10 — AccessControlManager Contract
- **Status**: Draft / Approved Design
- **Date**: 2026-07-31
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `AccessControlManager` contract provides role-based access control (RBAC) across all smart contracts in the HoloFi protocol (`HoloFiCardCollection`, `HoloFiVaultLoanCore`, `HoloFiLendingVault`, `HoloFiDutchAuction`). It establishes centralized authority delegation while enforcing strict least-privilege principles.

---

## 2. Technical Specification

### 2.1 Contract Architecture
* **File Location**: `contracts/AccessControlManager.sol`
* **Base Contract**: `@openzeppelin/contracts/access/AccessControl.sol`
* **Solidity Version**: `^0.8.28`

### 2.2 Roles Definition
The contract defines the following immutable role identifiers:

| Role Name | Constant Name | Value / Expression | Description |
|-----------|---------------|-------------------|-------------|
| Default Admin | `DEFAULT_ADMIN_ROLE` | `bytes32(0)` | Super-admin role from OpenZeppelin `AccessControl` |
| Protocol Admin | `ADMIN_ROLE` | `keccak256("ADMIN_ROLE")` | Main administrative role for managing operational roles |
| Oracle | `ORACLE_ROLE` | `keccak256("ORACLE_ROLE")` | Authorized Chainlink CRE node & FMV analytics signers |
| KYB Manager | `KYB_MANAGER_ROLE` | `keccak256("KYB_MANAGER_ROLE")` | Authorized KYB compliance managers |
| Pauser | `PAUSER_ROLE` | `keccak256("PAUSER_ROLE")` | Emergency pause/unpause operator |

### 2.3 Role Admin Hierarchy
* `ADMIN_ROLE` is assigned as the role admin for:
  - `ADMIN_ROLE`
  - `ORACLE_ROLE`
  - `KYB_MANAGER_ROLE`
  - `PAUSER_ROLE`
* Accounts possessing `ADMIN_ROLE` or `DEFAULT_ADMIN_ROLE` can grant or revoke any of the operational roles.

### 2.4 Custom Errors
* `ZeroAddressAdmin()`: Reverts when constructor is called with `address(0)`.

### 2.5 Functions
* **Constructor**: `constructor(address initialAdmin)`
  - Input validation: `require(initialAdmin != address(0), ZeroAddressAdmin())`
  - Assigns `DEFAULT_ADMIN_ROLE` to `initialAdmin` via `_grantRole`.
  - Assigns `ADMIN_ROLE` to `initialAdmin` via `_grantRole`.
  - Sets `ADMIN_ROLE` as role admin for `ADMIN_ROLE`, `ORACLE_ROLE`, `KYB_MANAGER_ROLE`, and `PAUSER_ROLE` via `_setRoleAdmin`.
* **Standard AccessControl Methods** (Inherited):
  - `hasRole(bytes32 role, address account) -> bool`
  - `grantRole(bytes32 role, address account)`
  - `revokeRole(bytes32 role, address account)`
  - `renounceRole(bytes32 role, address callerConfirmation)`

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/AccessControlManager.t.sol`)
Using `forge-std/Test.sol` cheatcodes & assertions:
1. `test_ConstructorInitialState`: Verify `initialAdmin` has `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE`.
2. `test_RevertIf_ZeroAddressAdmin`: Verify constructor reverts with `ZeroAddressAdmin()` when passed `address(0)`.
3. `test_GrantRoleByAdmin`: Verify `ADMIN_ROLE` holder can grant `ORACLE_ROLE`, `KYB_MANAGER_ROLE`, and `PAUSER_ROLE`.
4. `test_RevokeRoleByAdmin`: Verify `ADMIN_ROLE` holder can revoke roles.
5. `test_RevertIf_UnauthorizedGrant`: Verify non-admin account fails to grant roles with `AccessControlUnauthorizedAccount`.
6. `test_RenounceRole`: Verify role holder can renounce their role.

### 3.2 TypeScript Integration Tests (`test/AccessControlManager.ts`)
Using `@nomicfoundation/hardhat-toolbox-mocha-ethers` + Mocha + Chai:
1. Deploy contract fixture via `ethers.deployContract("AccessControlManager", [admin.address])`.
2. Verify role checking methods and event emissions (`RoleGranted`, `RoleRevoked`).
3. Test custom error assertions via `.to.be.revertedWithCustomError`.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
