# `HoloFiCardPriceFeed` Smart Contract Specification

- **Feature**: HF-17 — Develop `HoloFiCardPriceFeed.sol` Smart Contract
- **Status**: Draft / Approved Design
- **Date**: 2026-08-06
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines `HoloFiCardPriceFeed.sol`, a gas-optimized on-chain Fair Market Value (FMV) price registry for HoloFi protocol. It stores 18-decimal USD prices for TCG card models (`cardTypeId`), packed efficiently into a single 256-bit storage slot per card model. Price updates are role-gated to authorized oracle operators (`ORACLE_ROLE`) via `AccessControlManager`.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Smart Contract**: `contracts/HoloFiCardPriceFeed.sol`
* **Solidity Unit Tests**: `contracts/HoloFiCardPriceFeed.t.sol`
* **TypeScript Integration Tests**: `test/HoloFiCardPriceFeed.ts`

### 2.2 Data Structures & Storage Layout

```solidity
struct PriceData {
    uint128 price;       // 18-decimal USD Fair Market Value
    uint128 lastUpdated; // Block timestamp of price update
}

AccessControlManager public immutable acm;
mapping(bytes32 => PriceData) public prices;
```

### 2.3 Custom Errors & Events

```solidity
error ZeroAddressACM();
error UnauthorizedOracle(address caller);
error ZeroPrice();
error ArrayLengthMismatch();

event PriceUpdated(bytes32 indexed cardTypeId, uint128 price, uint128 timestamp);
```

### 2.4 Interface & Function Specifications

```solidity
contract HoloFiCardPriceFeed {
    modifier onlyOracle() {
        if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender)) {
            revert UnauthorizedOracle(msg.sender);
        }
        _;
    }

    constructor(address _acm) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

    function setPrice(bytes32 cardTypeId, uint128 price) external onlyOracle {
        if (price == 0) {
            revert ZeroPrice();
        }
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
            prices[cardTypeId] = PriceData({
                price: price,
                lastUpdated: uint128(block.timestamp)
            });
            emit PriceUpdated(cardTypeId, price, uint128(block.timestamp));
        }
    }

    function getPrice(bytes32 cardTypeId) external view returns (uint256 price, bool isValid) {
        PriceData memory data = prices[cardTypeId];
        if (data.price == 0) {
            return (0, false);
        }
        return (uint256(data.price), true);
    }

    function getLatestPriceData(
        bytes32 cardTypeId
    ) external view returns (uint128 price, uint128 lastUpdated, bool isValid) {
        PriceData memory data = prices[cardTypeId];
        if (data.price == 0) {
            return (0, 0, false);
        }
        return (data.price, data.lastUpdated, true);
    }
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiCardPriceFeed.t.sol`)
1. `test_Constructor_InitialState`: Verify `acm` assignment and zero-address constructor revert (`ZeroAddressACM`).
2. `test_SetPrice_Success`: Oracle updates single card FMV, verifying storage update and `PriceUpdated` event emission.
3. `test_RevertIf_SetPrice_Unauthorized`: Non-oracle caller reverts `UnauthorizedOracle`.
4. `test_RevertIf_SetPrice_ZeroPrice`: Zero-price input reverts `ZeroPrice`.
5. `test_SetBatchPrices_Success`: Oracle updates array of card FMVs in single tx.
6. `test_RevertIf_SetBatchPrices_LengthMismatch`: Array length mismatch reverts `ArrayLengthMismatch`.
7. `test_GetPrice_Uninitialized`: Query for uninitialized `cardTypeId` returns `(0, false)`.

### 3.2 TypeScript Integration Tests (`test/HoloFiCardPriceFeed.ts`)
1. Verify role enforcement with Ethers v6 signers and Chai matchers.
2. Verify batch price setting and getter responses.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Full test suite passing: `npx hardhat test`
