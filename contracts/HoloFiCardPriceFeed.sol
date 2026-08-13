// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title HoloFiCardPriceFeed
 * @notice Gas-optimized Fair Market Value (FMV) price feed registry for TCG card models.
 */
contract HoloFiCardPriceFeed {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct PriceData {
        uint128 price;       // 18-decimal USD Fair Market Value
        uint128 lastUpdated; // Block timestamp of price update
    }

    AccessControlManager public immutable acm;
    mapping(bytes32 => PriceData) public prices;
    EnumerableSet.Bytes32Set private _cardTypeIds;

    error ZeroAddressACM();
    error UnauthorizedOracle(address caller);
    error ZeroPrice();
    error ArrayLengthMismatch();

    event PriceUpdated(bytes32 indexed cardTypeId, uint128 price, uint128 timestamp);

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
