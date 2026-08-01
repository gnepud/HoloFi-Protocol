// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "./MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 public eurc;
    MockERC20 public weth;
    address public user = address(0x1111);

    function setUp() public {
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
    }

    function test_MockERC20_InitialState() public view {
        assertEq(eurc.name(), "Euro Coin");
        assertEq(eurc.symbol(), "EURC");
        assertEq(eurc.decimals(), 6);

        assertEq(weth.name(), "Wrapped Ether");
        assertEq(weth.symbol(), "WETH");
        assertEq(weth.decimals(), 18);
    }

    function test_MockERC20_Mint() public {
        eurc.mint(user, 1_000_000); // 1 EURC
        assertEq(eurc.balanceOf(user), 1_000_000);

        weth.mint(user, 1e18); // 1 WETH
        assertEq(weth.balanceOf(user), 1e18);
    }
}
