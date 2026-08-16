# KYC/KYB Status Management in `scripts/manage-roles.ts` Specification

- **Feature**: Add KYC/KYB Status Modification to `scripts/manage-roles.ts`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-16
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification enhances `scripts/manage-roles.ts` to allow protocol operators to modify the KYC/KYB compliance approval status (`setKybStatus`) for any specified wallet address on `AccessControlManager.sol`.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Script**: `scripts/manage-roles.ts`
* **Test Suite**: `test/ManageRolesScript.ts`
* **Documentation**: `docs/Deployment Guide.md`

---

### 2.2 CLI Syntax & Supported Actions

```bash
# Set KYC/KYB status to approved:
npm run roles kyb <target_address> true [acm_address] [--network <network>]
npm run roles kyc <target_address> approve [acm_address] [--network <network>]

# Set KYC/KYB status to revoked/rejected:
npm run roles kyb <target_address> false [acm_address] [--network <network>]
npm run roles kyc <target_address> reject [acm_address] [--network <network>]
```

#### Action Aliases
- `kyb`, `kyc`, `set-kyb`, `set-kyc`, `setkyb`, `setkyc`

#### Status Value Aliases
- **Approved (`true`)**: `true`, `1`, `approve`, `approved`, `pass`, `yes`, `enable`
- **Revoked / Rejected (`false`)**: `false`, `0`, `revoke`, `revoked`, `reject`, `rejected`, `no`, `disable`

---

### 2.3 Execution Flow & Authorization Check

1. **Signer Role Verification**:
   Verify caller possesses `KYB_MANAGER_ROLE` or `ADMIN_ROLE`. If neither, throw descriptive error.
2. **Idempotency Check**:
   If current status matches requested status, log info and skip transaction.
3. **Transaction Execution**:
   Call `acm.setKybStatus(targetAddress, status)` and await receipt.
4. **Output Report**:
   Print confirmed block number and display formatted ASCII status table via `checkRoles`.

---

## 3. Testing & Verification Strategy

### 3.1 Integration Tests (`test/ManageRolesScript.ts`)
- Test CLI argument parsing for `kyb` and `kyc` actions with various boolean aliases.
- Test `setKybStatus` helper approving an unapproved address, verifying `isKybApproved` becomes `true`.
- Test `setKybStatus` helper revoking an approved address, verifying `isKybApproved` becomes `false`.
- Test idempotency when setting already-matching status.
- Test unauthorized caller reversion when caller lacks `KYB_MANAGER_ROLE` / `ADMIN_ROLE`.

---

## 4. Verification Criteria

- Clean compilation & typecheck: `npx hardhat build && npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 200+ tests passing)
