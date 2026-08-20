// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/src/Test.sol";
import { DecimalMath } from "./DecimalMath.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract DecimalMathTest is Test {
    MockERC20 public token6;
    MockERC20 public token8;
    MockERC20 public token18;
    MockERC20 public token24;

    function setUp() public {
        token6 = new MockERC20("Token 6", "T6", 6);
        token8 = new MockERC20("Token 8", "T8", 8);
        token18 = new MockERC20("Token 18", "T18", 18);
        token24 = new MockERC20("Token 24", "T24", 24);
    }

    function test_NormalizeToAsset() public view {
        uint256 amount18 = 10_000 * 1e18; // $10,000 in 18 decimals

        assertEq(DecimalMath.normalizeToAsset(amount18, address(token6)), 10_000 * 1e6);
        assertEq(DecimalMath.normalizeToAsset(amount18, address(token8)), 10_000 * 1e8);
        assertEq(DecimalMath.normalizeToAsset(amount18, address(token18)), 10_000 * 1e18);
        assertEq(DecimalMath.normalizeToAsset(amount18, address(token24)), 10_000 * 1e24);
    }

    function test_ScaleFrom18() public pure {
        uint256 amount18 = 5_000 * 1e18;

        assertEq(DecimalMath.scaleFrom18(amount18, 6), 5_000 * 1e6);
        assertEq(DecimalMath.scaleFrom18(amount18, 8), 5_000 * 1e8);
        assertEq(DecimalMath.scaleFrom18(amount18, 18), 5_000 * 1e18);
        assertEq(DecimalMath.scaleFrom18(amount18, 24), 5_000 * 1e24);
    }

    function test_ScaleTo18() public pure {
        assertEq(DecimalMath.scaleTo18(5_000 * 1e6, 6), 5_000 * 1e18);
        assertEq(DecimalMath.scaleTo18(5_000 * 1e8, 8), 5_000 * 1e18);
        assertEq(DecimalMath.scaleTo18(5_000 * 1e18, 18), 5_000 * 1e18);
        assertEq(DecimalMath.scaleTo18(5_000 * 1e24, 24), 5_000 * 1e18);
    }
}
