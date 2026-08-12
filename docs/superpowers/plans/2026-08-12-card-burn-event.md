# Card Burning & `CardBurned` Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `burnCard` function, `CardBurned` event, and lock checks in `HoloFiVaultCard.sol`, alongside Solidity unit tests and TypeScript integration tests.

**Architecture:** Add `event CardBurned` and `error UnauthorizedBurner` in `HoloFiVaultCard.sol`. Update `_update` to check lock status when `from != address(0)`. Implement `burnCard(uint256 tokenId)` to clear metadata, burn token, and emit `CardBurned` event.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `burnCard` in `HoloFiVaultCard.sol` & Solidity Unit Tests (`HoloFiVaultCard.t.sol`)

**Files:**
- Modify: `contracts/HoloFiVaultCard.sol`
- Modify: `contracts/HoloFiVaultCard.t.sol`

**Interfaces:**
- Produces: `burnCard(uint256 tokenId)` function and `CardBurned(uint256, address, bytes32)` event.

- [ ] **Step 1: Update `contracts/HoloFiVaultCard.sol`**

Add event, error, `_update` check, and `burnCard`:

```solidity
event CardBurned(uint256 indexed tokenId, address indexed owner, bytes32 indexed cardTypeId);
error UnauthorizedBurner(address caller);

function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
    address from = _ownerOf(tokenId);
    if (from != address(0)) {
        if (cards[tokenId].isLocked) {
            revert CardIsLocked(tokenId);
        }
    }
    return super._update(to, tokenId, auth);
}

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
    delete cards[tokenId];

    _burn(tokenId);

    emit CardBurned(tokenId, owner, cardTypeId);
}
```

- [ ] **Step 2: Update `contracts/HoloFiVaultCard.t.sol`**

Add unit tests for `burnCard`:
- `test_BurnCard_OwnerSuccess`
- `test_BurnCard_ApprovedOperatorSuccess`
- `test_RevertIf_BurnCard_UnauthorizedCaller`
- `test_RevertIf_BurnCard_LockedCard`
- `test_RevertIf_BurnCard_NonExistentToken`

- [ ] **Step 3: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (119 total Solidity unit tests).

- [ ] **Step 4: Commit Task 1**

```bash
git add contracts/HoloFiVaultCard.sol contracts/HoloFiVaultCard.t.sol
git commit -m "feat: implement burnCard function and CardBurned event in HoloFiVaultCard"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultCard.ts`)

**Files:**
- Modify: `test/HoloFiVaultCard.ts`

**Interfaces:**
- Produces: Integration tests for `burnCard` and `CardBurned` event emission.

- [ ] **Step 1: Update `test/HoloFiVaultCard.ts`**

Add integration test cases:
- `Should allow owner or approved operator to burn card and emit CardBurned event`
- `Should revert burn of locked card or by unauthorized caller`

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (162+ total tests).

- [ ] **Step 3: Commit Task 2**

```bash
git add test/HoloFiVaultCard.ts
git commit -m "test: add TypeScript integration tests for burnCard and CardBurned event"
```
