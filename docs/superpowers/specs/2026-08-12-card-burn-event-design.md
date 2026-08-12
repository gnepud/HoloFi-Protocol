# Card Burning & `CardBurned` Event Specification

- **Feature**: HF-52 — Card Burning & `CardBurned` Event in `HoloFiVaultCard`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-12
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines the card NFT burning mechanism and event emission for `HoloFiVaultCard.sol`. When a card NFT owner or approved operator burns a physical card NFT on-chain, the contract verifies authorization and lock status, cleans up metadata storage, executes `_burn(tokenId)`, and emits the `CardBurned` event.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Smart Contract**: `contracts/HoloFiVaultCard.sol`
* **Solidity Unit Tests**: `contracts/HoloFiVaultCard.t.sol`
* **TypeScript Integration Tests**: `test/HoloFiVaultCard.ts`

---

### 2.2 Interface & Function Specification

#### 1. Event Definition
```solidity
event CardBurned(
    uint256 indexed tokenId,
    address indexed owner,
    bytes32 indexed cardTypeId,
    bytes32 attestationHash
);
```

#### 2. Custom Error Definition
```solidity
error UnauthorizedBurner(address caller);
```

#### 3. Lock Safeguard in `_update`
```solidity
function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
    address from = _ownerOf(tokenId);
    if (from != address(0)) {
        if (cards[tokenId].isLocked) {
            revert CardIsLocked(tokenId);
        }
    }
    return super._update(to, tokenId, auth);
}
```

#### 4. `burnCard` Function Implementation
```solidity
function burnCard(uint256 tokenId) external {
    address owner = _ownerOf(tokenId);
    if (owner == address(0)) {
        revert TokenDoesNotExist(tokenId);
    }
    if (cards[tokenId].isLocked) {
        revert CardIsLocked(tokenId);
    }
    if (msg.sender != owner && !_isAuthorized(owner, msg.sender, tokenId)) {
        revert UnauthorizedBurner(msg.sender);
    }

    bytes32 cardTypeId = cards[tokenId].cardTypeId;
    bytes32 attestationHash = cards[tokenId].attestationHash;
    delete cards[tokenId];

    _burn(tokenId);

    emit CardBurned(tokenId, owner, cardTypeId, attestationHash);
}
```

---

## 3. Testing & Verification Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiVaultCard.t.sol`)
1. `test_BurnCard_OwnerSuccess`: Owner burns card, asserts `CardBurned` event emitted, `ownerOf(tokenId)` reverts, `cards[tokenId]` cleared.
2. `test_BurnCard_ApprovedOperatorSuccess`: Approved operator burns card successfully.
3. `test_RevertIf_BurnCard_UnauthorizedCaller`: Non-owner, non-approved caller reverts `UnauthorizedBurner`.
4. `test_RevertIf_BurnCard_LockedCard`: Reverts `CardIsLocked` when card is locked.
5. `test_RevertIf_BurnCard_NonExistentToken`: Reverts `TokenDoesNotExist` for invalid token ID.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultCard.ts`)
1. Integration test for `burnCard` by card owner and event listener verification.
2. Integration test asserting reverts for unauthorized callers and locked cards.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 160+ tests passing)
