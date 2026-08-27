// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title HoloFiCardPriceFeed
/// @author Peng Du
/// @notice Stores and provides fair market value prices for supported card types.
/// @dev Uses 18-decimal USD fixed-point precision for card prices.
contract HoloFiCardPriceFeed {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice Holds price valuation and timestamp for a card type.
    /// @dev Both fields pack into a single 256-bit storage slot.
    struct PriceData {
        uint128 price;       // 18-decimal USD Fair Market Value
        uint128 lastUpdated; // Block timestamp of price update
    }

    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice Maps a card type identifier to its latest price record.
    mapping(bytes32 => PriceData) public prices;

    /// @dev Internal set tracking all registered card type identifiers.
    EnumerableSet.Bytes32Set private _cardTypeIds;

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when the caller does not hold the oracle role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedOracle(address caller);

    /// @notice Reverts when an input price is zero.
    error ZeroPrice();

    /// @notice Reverts when batch input arrays have different lengths.
    error ArrayLengthMismatch();

    /// @notice Emitted when a card type price is updated.
    /// @param cardTypeId Unique identifier of the updated card type.
    /// @param price The new price in 18-decimal USD.
    /// @param timestamp Block timestamp of the update.
    event PriceUpdated(bytes32 indexed cardTypeId, uint128 price, uint128 timestamp);

    modifier onlyOracle() {
        if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender)) {
            revert UnauthorizedOracle(msg.sender);
        }
        _;
    }

    /// @notice Initializes the price feed registry.
    /// @param _acm The address of the AccessControlManager contract.
    constructor(address _acm) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

    /// @notice Sets the fair market value price for a single card type.
    /// @dev If the card type is new, this function adds it to the registry.
    /// @param cardTypeId Unique identifier of the card type.
    /// @param price Fair market value in 18-decimal USD precision.
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

    /// @notice Sets fair market value prices for multiple card types in batch.
    /// @param cardTypeIds Array of card type identifiers to update.
    /// @param newPrices Array of 18-decimal USD prices matching the identifiers.
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

    /// @notice Retrieves the current price and update timestamp for a card type.
    /// @param cardTypeId Unique identifier of the card type.
    /// @return price Fair market value in 18-decimal USD precision.
    /// @return lastUpdated Timestamp when the price was last recorded.
    function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated) {
        PriceData memory data = prices[cardTypeId];
        return (uint256(data.price), data.lastUpdated);
    }

    /// @notice Returns the total number of registered card types.
    /// @return Total count of registered card types.
    function getCardTypesCount() external view returns (uint256) {
        return _cardTypeIds.length();
    }

    /// @notice Returns the card type identifier at a specific set index.
    /// @param index Zero-based index in the card type set.
    /// @return Card type identifier at the index.
    function getCardTypeAt(uint256 index) external view returns (bytes32) {
        return _cardTypeIds.at(index);
    }

    /// @notice Returns an array of all registered card type identifiers.
    /// @return Array containing all active card type keys.
    function getAllCardTypes() external view returns (bytes32[] memory) {
        return _cardTypeIds.values();
    }

    /// @notice Checks whether a card type identifier is registered in the price feed.
    /// @param cardTypeId Card type identifier to check.
    /// @return True if the card type exists in the registry, false otherwise.
    function isSupportedCardType(bytes32 cardTypeId) external view returns (bool) {
        return _cardTypeIds.contains(cardTypeId);
    }
}
