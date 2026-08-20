// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title DecimalMath
 * @notice Utility library for normalizing 18-decimal fixed-point amounts to arbitrary ERC20 token precisions.
 */
library DecimalMath {
    /**
     * @notice Scales an 18-decimal value to the native precision of the specified ERC20 token.
     * @param amount18 The 18-decimal fixed-point amount.
     * @param asset The address of the target ERC20 token.
     * @return The amount scaled to the token's native decimals.
     */
    function normalizeToAsset(uint256 amount18, address asset) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(asset).decimals();
        return scaleFrom18(amount18, decimals);
    }

    /**
     * @notice Scales an 18-decimal value to a target decimal precision.
     * @param amount18 The 18-decimal fixed-point amount.
     * @param targetDecimals The target decimal precision.
     * @return The scaled amount.
     */
    function scaleFrom18(uint256 amount18, uint8 targetDecimals) internal pure returns (uint256) {
        if (targetDecimals == 18) return amount18;
        if (targetDecimals < 18) {
            return amount18 / (10 ** (18 - targetDecimals));
        } else {
            return amount18 * (10 ** (targetDecimals - 18));
        }
    }

    /**
     * @notice Scales an amount from a native decimal precision up to 18 decimals.
     * @param amount The native amount.
     * @param sourceDecimals The source decimal precision.
     * @return The amount scaled to 18 decimals.
     */
    function scaleTo18(uint256 amount, uint8 sourceDecimals) internal pure returns (uint256) {
        if (sourceDecimals == 18) return amount;
        if (sourceDecimals < 18) {
            return amount * (10 ** (18 - sourceDecimals));
        } else {
            return amount / (10 ** (sourceDecimals - 18));
        }
    }
}
