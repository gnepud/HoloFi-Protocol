# View Vault Card NFT CLI Script Specification (`scripts/view-card.ts`)

- **Feature**: View Vault Card NFT Details by Token ID
- **Status**: Draft / Approved Design
- **Date**: 2026-08-16
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines the CLI tool `scripts/view-card.ts` allowing operators, stores, and users to query and inspect all on-chain metadata for any `HoloFiVaultCard` NFT by its `tokenId`.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Script**: `scripts/view-card.ts`
* **Test Suite**: `test/ViewCardScript.ts`
* **Documentation**: `docs/Deployment Guide.md`
* **Configuration**: `package.json` (`"view-card": "tsx scripts/view-card.ts"`)

---

### 2.2 CLI Commands & Syntax

```bash
# Method A: Direct CLI execution (Recommended)
npm run view-card <tokenId> [vaultCardAddress] [--network <network>]
# or
npx tsx scripts/view-card.ts <tokenId> [vaultCardAddress] [--network <network>]

# Method B: Hardhat run with environment variables
TOKEN_ID=<tokenId> npx hardhat run scripts/view-card.ts --network <network>
```

---

### 2.3 Retrieved Data Points

1. **Basic Token Data**:
   - `ownerOf(tokenId)`: Current wallet address owning the NFT.
   - `tokenURI(tokenId)`: IPFS / HTTP metadata URI.
   - `name()` & `symbol()`: Collection name and symbol.
2. **On-Chain Vault Card Metadata (`getCard(tokenId)`)**:
   - `tokenId`: Unique token identifier.
   - `cardTypeId`: 32-byte model identifier.
   - `attestationHash`: 32-byte physical vault attestation proof hash.
   - `mintTimestamp`: Unix timestamp and formatted UTC string.
   - `isLocked`: Boolean indicating whether the card is currently locked in loan collateral escrow.
3. **Oracle Price Enrichment (Optional / If PriceFeed Deployed)**:
   - Queries `priceFeed.getPrice(cardTypeId)` to display current FMV price in USD and last updated timestamp.

---

### 2.4 Address Resolution Strategy

1. Positional CLI argument `[vaultCardAddress]` or `--contract <address>`.
2. Environment variables `VAULT_CARD_ADDRESS` / `CARD_ADDRESS`.
3. Auto-discovery from Hardhat Ignition deployments (`ignition/deployments/chain-<chainId>/deployed_addresses.json` matching `"DeployHoloFiProtocol#HoloFiVaultCard"` or `"HoloFiVaultCard"`).

---

## 3. Testing & Verification Strategy

### 3.1 Integration Tests (`test/ViewCardScript.ts`)
- Test `parseCliArgs` with token ID, custom contract address, `--network` flag, and environment variables.
- Test `fetchCardDetails`:
  - Mint card and verify returned details (`owner`, `tokenURI`, `cardTypeId`, `attestationHash`, `isLocked`, `mintTimestamp`).
  - Lock card and verify `isLocked` updates to `true`.
  - Burn card and verify `TokenDoesNotExist` / `ERC721NonexistentToken` error handling.
- Test `formatCardDetailsTable` ASCII generation.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build && npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 210+ tests passing)
