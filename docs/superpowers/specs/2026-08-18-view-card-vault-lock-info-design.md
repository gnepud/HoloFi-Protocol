# View Card Script: Vault & Owner Display for Locked Cards Design Spec

- **Feature**: Display Vault ID and Vault Owner for Locked Card NFTs in `view-card`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-18
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

When inspecting a `HoloFiVaultCard` NFT with `scripts/view-card.ts`, if the card is locked (`isLocked == true`) as loan collateral, the script will automatically query `HoloFiVaultLoanCore` to retrieve and display:
1. The **Vault ID** (`vaultId`) holding the locked card.
2. The **Vault Owner** (`vaultOwner` / Store wallet address).
3. The **Vault Status** (`Active`, `Liquidating`, or `Closed`).
4. The **Loan Core Escrow Contract Address**.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Script**: `scripts/view-card.ts`
* **Test Suite**: `test/ViewCardScript.ts`
* **Documentation**: `docs/Deployment Guide.md`

---

### 2.2 Data Model & Interface Extensions

```typescript
export interface VaultLockInfo {
  vaultId: bigint;
  vaultOwner: string;
  loanCoreAddress: string;
  vaultStatus: "Active" | "Liquidating" | "Closed" | "Unknown";
  principalDebt?: bigint;
  accumulatedInterest?: bigint;
}

export interface CardDetails {
  // Existing fields...
  tokenId: bigint;
  contractAddress: string;
  contractName: string;
  contractSymbol: string;
  owner: string;
  tokenURI: string;
  cardTypeId: string;
  attestationHash: string;
  mintTimestamp: bigint;
  mintDate: string;
  isLocked: boolean;
  priceFeedAddress?: string;
  priceInfo?: CardPriceInfo;
  // New fields:
  loanCoreAddress?: string;
  vaultLockInfo?: VaultLockInfo;
}
```

---

### 2.3 Contract Interaction & Query Flow

1. Resolve `loanCoreAddress` via CLI argument (`--loan-core`), environment variable (`LOAN_CORE_ADDRESS`), or Ignition deployment artifacts (`DeployHoloFiProtocol#HoloFiVaultLoanCore`).
2. In `fetchCardDetails(vaultCard, tokenId, priceFeed?, loanCore?)`:
   - If `loanCore` is available, query `vaultId = await loanCore.nftVaultId(tokenId)`.
   - If `vaultId > 0n`:
     - Query `vault = await loanCore.getVault(vaultId)`.
     - Extract `vaultOwner = vault.owner`, `vaultStatus` (`Active` / `Liquidating` / `Closed`), `principalDebt`, and `accumulatedInterest`.
3. In `formatCardDetailsTable(details)`:
   - When `details.isLocked` and `details.vaultLockInfo` exist, render:
     ```text
     Lock Status        : LOCKED [In Escrow / Collateralized]
     Locked in Vault    : Vault #1 (Status: Active)
     Vault Owner (Store): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
     Loan Core Escrow   : 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707
     ```
   - When `isLocked` is `false`, render:
     ```text
     Lock Status        : UNLOCKED [Free / Transferable]
     ```

---

## 3. Testing Strategy (`test/ViewCardScript.ts`)

- Test argument parsing for `--loan-core`, `-l`, and `LOAN_CORE_ADDRESS` env var.
- Test `fetchCardDetails` with locked card in a vault, asserting `vaultLockInfo` populated with correct `vaultId`, `vaultOwner`, `loanCoreAddress`, and `vaultStatus`.
- Test `fetchCardDetails` with unlocked card, asserting `vaultLockInfo` is undefined.
- Test `formatCardDetailsTable` rendering vault ID, owner, and status for locked cards.

---

## 4. Verification Criteria

- Compilation & typecheck: `npx hardhat build && npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 273+ tests passing)
