# EnumerableSet in `HoloFiCardPriceFeed` Specification

- **Feature**: Enumerable Card Type Set in `HoloFiCardPriceFeed`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-13
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification enhances `HoloFiCardPriceFeed.sol` by integrating OpenZeppelin's `EnumerableSet.Bytes32Set` alongside the packed `PriceData` mapping. This allows on-chain and off-chain consumers to enumerate all registered card types, check membership in O(1), and retrieve total counts and slices, while preserving optimal gas efficiency for price reads in `HoloFiVaultLoanCore`.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Contract**: `contracts/HoloFiCardPriceFeed.sol`
* **Dependencies**: `@openzeppelin/contracts/utils/structs/EnumerableSet.sol`
* **Solidity Unit Tests**: `contracts/HoloFiCardPriceFeed.t.sol`
* **TypeScript Integration Tests**: `test/HoloFiCardPriceFeed.ts`
* **System Architecture Document**: `docs/System Architecture Document.md`

---

### 2.2 Contract Modifications (`HoloFiCardPriceFeed.sol`)

```solidity
import { AccessControlManager } from "./AccessControlManager.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract HoloFiCardPriceFeed {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct PriceData {
        uint128 price;       // 18-decimal USD Fair Market Value
        uint128 lastUpdated; // Block timestamp of price update
    }

    AccessControlManager public immutable acm;
    mapping(bytes32 => PriceData) public prices;
    EnumerableSet.Bytes32Set private _cardTypeIds;

    // ... Events and Errors ...

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

    function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated) {
        PriceData memory data = prices[cardTypeId];
        return (uint256(data.price), data.lastUpdated);
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
}
```

---

## 3. Testing & Verification Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiCardPriceFeed.t.sol`)
1. `test_SetPrice_AddsToEnumerableSet`: Verify `getCardTypesCount()`, `isSupportedCardType()`, `getCardTypeAt(0)`, `getAllCardTypes()`.
2. `test_SetBatchPrices_AddsToEnumerableSet`: Verify batch insertions and duplicate insertions maintain correct set count and values.
3. `test_RevertIf_GetCardTypeAt_OutOfBounds`: Calling `getCardTypeAt` with out-of-bounds index reverts.

### 3.2 TypeScript Integration Tests (`test/HoloFiCardPriceFeed.ts`)
1. Test `getCardTypesCount`, `getCardTypeAt`, `getAllCardTypes`, and `isSupportedCardType` after setting prices and batch prices.
2. Verify existing `LoanCore` and `DutchAuction` regression test suites pass without issues.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build`
- Clean typecheck: `npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 168+ tests passing)
