// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiCardPriceFeed
 * @notice Gas-optimized Fair Market Value (FMV) price feed registry for TCG card models.
 */
contract HoloFiCardPriceFeed {
    struct PriceData {
        uint128 price;       // 18-decimal USD Fair Market Value
        uint128 lastUpdated; // Block timestamp of price update
    }

    AccessControlManager public immutable acm;
    mapping(bytes32 => PriceData) public prices;

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
