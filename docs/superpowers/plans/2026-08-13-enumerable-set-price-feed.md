# EnumerableSet in `HoloFiCardPriceFeed` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate OpenZeppelin's `EnumerableSet.Bytes32Set` into `HoloFiCardPriceFeed.sol` to track and enumerate all registered card types, while maintaining the gas-optimized packed `PriceData` mapping for O(1) reads.

**Architecture:** Add `EnumerableSet.Bytes32Set private _cardTypeIds;` in `HoloFiCardPriceFeed.sol`. Update `setPrice` and `setBatchPrices` to register card types in the set. Expose `getCardTypesCount()`, `getCardTypeAt(uint256)`, `getAllCardTypes()`, and `isSupportedCardType(bytes32)` view functions. Cover with Solidity unit tests and TypeScript integration tests.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `EnumerableSet.Bytes32Set` in `HoloFiCardPriceFeed.sol` & Solidity Unit Tests (`HoloFiCardPriceFeed.t.sol`)

**Files:**
- Modify: `contracts/HoloFiCardPriceFeed.sol`
- Modify: `contracts/HoloFiCardPriceFeed.t.sol`

**Interfaces:**
- Produces: `getCardTypesCount()`, `getCardTypeAt(uint256)`, `getAllCardTypes()`, and `isSupportedCardType(bytes32)`.

- [ ] **Step 1: Update `contracts/HoloFiCardPriceFeed.sol`**

Add `EnumerableSet` import, `using EnumerableSet for EnumerableSet.Bytes32Set;`, state variable `_cardTypeIds`, updates in `setPrice` / `setBatchPrices`, and enumeration helper functions:

```solidity
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

// inside HoloFiCardPriceFeed:
using EnumerableSet for EnumerableSet.Bytes32Set;

EnumerableSet.Bytes32Set private _cardTypeIds;

function setPrice(bytes32 cardTypeId, uint128 price) external onlyOracle {
    if (price == 0) {
        revert ZeroPrice();
    }
    _cardTypeIds.add(cardTypeId);
    prices[cardTypeId] = PriceData({
        price: price,
        lastUpdated: uint128(block.timestamp)
    });
    emit PriceUpdated(cardTypeId, price, uint128(block.timestamp));
}

function setBatchPrices(
    bytes32[] calldata cardTypeIds,
    uint128[] calldata newPrices
) external onlyOracle {
    uint256 len = cardTypeIds.length;
    if (len != newPrices.length) {
        revert ArrayLengthMismatch();
    }
    for (uint256 i = 0; i < len; i++) {
        uint128 price = newPrices[i];
        if (price == 0) {
            revert ZeroPrice();
        }
        bytes32 cardTypeId = cardTypeIds[i];
        _cardTypeIds.add(cardTypeId);
        prices[cardTypeId] = PriceData({
            price: price,
            lastUpdated: uint128(block.timestamp)
        });
        emit PriceUpdated(cardTypeId, price, uint128(block.timestamp));
    }
}

function getCardTypesCount() external view returns (uint256) {
    return _cardTypeIds.length();
}

function getCardTypeAt(uint256 index) external view returns (bytes32) {
    return _cardTypeIds.at(index);
}

function getAllCardTypes() external view returns (bytes32[] memory) {
    return _cardTypeIds.values();
}

function isSupportedCardType(bytes32 cardTypeId) external view returns (bool) {
    return _cardTypeIds.contains(cardTypeId);
}
```

- [ ] **Step 2: Update `contracts/HoloFiCardPriceFeed.t.sol`**

Add unit tests:
- `test_SetPrice_AddsToEnumerableSet`
- `test_SetBatchPrices_AddsToEnumerableSet`
- `test_RevertIf_GetCardTypeAt_OutOfBounds`
- `test_IsSupportedCardType`
- `test_GetAllCardTypes`

- [ ] **Step 3: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (124+ total Solidity unit tests).

- [ ] **Step 4: Commit Task 1**

```bash
git add contracts/HoloFiCardPriceFeed.sol contracts/HoloFiCardPriceFeed.t.sol
git commit -m "feat: add EnumerableSet card type tracking in HoloFiCardPriceFeed"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiCardPriceFeed.ts`) & Architecture Docs

**Files:**
- Modify: `test/HoloFiCardPriceFeed.ts`
- Modify: `docs/System Architecture Document.md`

**Interfaces:**
- Produces: TypeScript integration tests for EnumerableSet functions and updated architecture documentation.

- [ ] **Step 1: Update `test/HoloFiCardPriceFeed.ts`**

Add tests:
- Assert `getCardTypesCount()`, `getCardTypeAt()`, `getAllCardTypes()`, and `isSupportedCardType()` after setting single and batch prices.
- Assert duplicate sets do not duplicate entries in `getCardTypesCount()`.

- [ ] **Step 2: Update `docs/System Architecture Document.md`**

Update `HoloFiCardPriceFeed` section to document `EnumerableSet` tracking.

- [ ] **Step 3: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (170+ total tests).

- [ ] **Step 4: Commit Task 2**

```bash
git add test/HoloFiCardPriceFeed.ts "docs/System Architecture Document.md"
git commit -m "test: add TypeScript integration tests for EnumerableSet in HoloFiCardPriceFeed"
```
