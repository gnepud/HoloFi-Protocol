# Role Management Script Specification (`scripts/manage-roles.ts`)

- **Feature**: Role Management CLI Script for `AccessControlManager`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-14
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines the CLI script `scripts/manage-roles.ts` to inspect, grant, and revoke roles on `AccessControlManager.sol` for any specified wallet address. The script is executable via Hardhat 3 CLI (`npx hardhat run scripts/manage-roles.ts --network <network> -- <command> [args]`).

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Script**: `scripts/manage-roles.ts`
* **Documentation**: `docs/Deployment Guide.md`
* **Test Suite**: `test/ManageRolesScript.ts` (or unit integration test)

---

### 2.2 CLI Commands & Syntax (Mode A Positional Arguments)

```bash
# 1. View all role permissions and KYB status of a wallet address:
npx hardhat run scripts/manage-roles.ts --network localhost -- check <TARGET_ADDRESS> [ACM_ADDRESS]

# 2. Grant a role to a wallet address:
npx hardhat run scripts/manage-roles.ts --network localhost -- grant <TARGET_ADDRESS> <ROLE_NAME> [ACM_ADDRESS]

# 3. Revoke a role from a wallet address:
npx hardhat run scripts/manage-roles.ts --network localhost -- revoke <TARGET_ADDRESS> <ROLE_NAME> [ACM_ADDRESS]
```

#### Supported Roles & Aliases
- `ADMIN_ROLE` (aliases: `admin`, `ADMIN`)
- `ORACLE_ROLE` (aliases: `oracle`, `ORACLE`, `feeder`)
- `MINTER_ROLE` (aliases: `minter`, `MINTER`)
- `KYB_MANAGER_ROLE` (aliases: `kyb`, `KYB`, `kyb_manager`)
- `PAUSER_ROLE` (aliases: `pauser`, `PAUSER`)
- `DEFAULT_ADMIN_ROLE` (aliases: `default_admin`, `root`)

---

### 2.3 ACM Address Resolution Strategy
1. Positional argument `[ACM_ADDRESS]` if provided.
2. `ACM_ADDRESS` environment variable if defined.
3. Automatically parses Hardhat Ignition deployment artifacts (`ignition/deployments/chain-<chainId>/deployed_addresses.json` or `artifacts/`).
4. Reverts with a descriptive error message if no ACM address could be resolved.

---

## 3. Output Format

### Check / List Output Example:
```
========================================================================
📋 HoloFi Role Permissions Report
========================================================================
Target Wallet : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
ACM Contract  : 0x5FbDB2315678afecb367f032d93F642f64180aa3
Network       : localhost (Chain ID: 31337)
KYB Approved  : ✅ YES
------------------------------------------------------------------------
Role Name            Status          Role Hash
------------------------------------------------------------------------
DEFAULT_ADMIN_ROLE   ✅ GRANTED      0x0000000000000000000000000000000000000000000000000000000000000000
ADMIN_ROLE           ✅ GRANTED      0xdf8b4c520ffe197c5343c6f5aec59570151ef9a492f2c624fd45ddde6135ec42
ORACLE_ROLE          ❌ NOT GRANTED  0x84061a9386d34b46c6f93282b0e6878b66802ff60b81628d0987514a382d6b1d
MINTER_ROLE          ✅ GRANTED      0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6
KYB_MANAGER_ROLE     ❌ NOT GRANTED  0x14041d8d80c35da2bc178c772c68ae3901b0f592233f21ef4582f059bcad5f9a
PAUSER_ROLE          ❌ NOT GRANTED  0x65d788350e48cde8802122734380add476378043874402488a04c6cb822cd91c
========================================================================
```

---

## 4. Verification Criteria

- Clean execution on `localhost` for `check`, `grant`, `revoke`.
- Full test suite passing: `npx hardhat build && npx tsc --noEmit && npx hardhat test`.
- Deployment guide updated with CLI usage examples.
