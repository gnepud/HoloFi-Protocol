# ERC-721 Transfer Restrictions Specification

- **Feature**: HF-14 — Enforce ERC-721 Transfer Restrictions
- **Status**: Draft / Approved Design
- **Date**: 2026-07-31
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiCardCollection` smart contract allows standard, unrestricted ERC-721 NFT transfers between wallets outside of loans. However, when an NFT is locked under collateral staking (`isLocked == true`), any transfer attempt is blocked to prevent collateral escape.

---

## 2. Technical Specification

### 2.1 File Location & Dependencies
* **File Location**: `contracts/HoloFiCardCollection.sol`
* **Base Contract**: `ERC721URIStorage` (`@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol`)

### 2.2 Custom Errors
* `CardIsLocked(uint256 tokenId)`: Reverts when attempting to transfer an NFT that has `isLocked == true`.

### 2.3 Overridden Transfer Hook

#### `_update(address to, uint256 tokenId, address auth) internal override returns (address)`
- **Minting (`from == address(0)`)**: Calls `super._update(to, tokenId, auth)` directly.
- **Burning (`to == address(0)`)**: Calls `super._update(to, tokenId, auth)` directly.
- **Transferring (`from != address(0)` && `to != address(0)`)**:
  1. If `cards[tokenId].isLocked == true`: Revert `CardIsLocked(tokenId)`.
  2. Execute `super._update(to, tokenId, auth)`.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiCardCollection.t.sol`)
1. `test_Transfer_UnlockedCard_Success`: Unlocked card (`isLocked == false`) transfers freely between wallets.
2. `test_RevertIf_TransferLockedCard`: Locked card (`isLocked == true`) reverts with `CardIsLocked(tokenId)`.

### 3.2 TypeScript Integration Tests (`test/HoloFiCardCollection.ts`)
1. Mint card to User A.
2. Verify User A -> User B transfer succeeds when unlocked.
3. Lock card via `setCardLock(tokenId, true)` as Admin.
4. Verify User B -> User A transfer reverts with custom error `CardIsLocked`.
5. Unlock card via `setCardLock(tokenId, false)` and verify transfer succeeds.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
