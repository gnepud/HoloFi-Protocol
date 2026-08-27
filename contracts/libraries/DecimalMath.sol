// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title DecimalMath
/// @author Peng Du
/// @notice Normalizes 18-decimal fixed-point amounts to ERC-20 token precisions.
/// @dev Provides scaling functions between 18-decimal fixed points and arbitrary token decimals.
library DecimalMath {
    /// @notice Scales an 18-decimal amount to the decimal precision of a target token.
    /// @param amount18 The 18-decimal fixed-point amount.
    /// @param asset The target ERC-20 token address.
    /// @return The amount scaled to the token decimals.
    function normalizeToAsset(uint256 amount18, address asset) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(asset).decimals();
        return scaleFrom18(amount18, decimals);
    }

    /// @notice Scales an 18-decimal amount to a target decimal precision.
    /// @param amount18 The 18-decimal fixed-point amount.
    /// @param targetDecimals The destination decimal precision.
    /// @return The scaled amount.
    function scaleFrom18(uint256 amount18, uint8 targetDecimals) internal pure returns (uint256) {
        if (targetDecimals == 18) return amount18;
        if (targetDecimals < 18) {
            return amount18 / (10 ** (18 - targetDecimals));
        } else {
            return amount18 * (10 ** (targetDecimals - 18));
        }
    }

    /// @notice Scales an amount from a source decimal precision up to 18 decimals.
    /// @param amount The native token amount.
    /// @param sourceDecimals The source decimal precision.
    /// @return The amount scaled to 18 decimals.
    function scaleTo18(uint256 amount, uint8 sourceDecimals) internal pure returns (uint256) {
        if (sourceDecimals == 18) return amount;
        if (sourceDecimals < 18) {
            return amount * (10 ** (18 - sourceDecimals));
        } else {
            return amount / (10 ** (sourceDecimals - 18));
        }
    }
}
