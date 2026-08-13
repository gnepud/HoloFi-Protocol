// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardPriceFeed } from "./HoloFiCardPriceFeed.sol";

contract HoloFiCardPriceFeedTest is Test {
    AccessControlManager public acm;
    HoloFiCardPriceFeed public priceFeed;

    address public admin = address(0x1);
    address public oracle = address(0x2);
    address public user = address(0x3);

    bytes32 public cardTypeId1 = keccak256("Pikachu_Illustrator_PSA10");
    bytes32 public cardTypeId2 = keccak256("Charizard_1st_Edition_PSA10");

    function setUp() public {
        acm = new AccessControlManager(admin);
        priceFeed = new HoloFiCardPriceFeed(address(acm));

        vm.startPrank(admin);
        acm.grantRole(acm.ORACLE_ROLE(), oracle);
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(priceFeed.acm()), address(acm));
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(HoloFiCardPriceFeed.ZeroAddressACM.selector);
        new HoloFiCardPriceFeed(address(0));
    }

    function test_SetPrice_Success() public {
        uint128 price = 50_000 * 1e18;
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, price);

        (uint256 fetchedPrice, uint128 lastUpdated) = priceFeed.getPrice(cardTypeId1);
        assertEq(fetchedPrice, price);
        assertEq(lastUpdated, block.timestamp);
    }

    function test_RevertIf_SetPrice_Unauthorized() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardPriceFeed.UnauthorizedOracle.selector, user));
        priceFeed.setPrice(cardTypeId1, 100 * 1e18);
    }

    function test_RevertIf_SetPrice_ZeroPrice() public {
        vm.prank(oracle);
        vm.expectRevert(HoloFiCardPriceFeed.ZeroPrice.selector);
        priceFeed.setPrice(cardTypeId1, 0);
    }

    function test_SetBatchPrices_Success() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cardTypeId1;
        ids[1] = cardTypeId2;

        uint128[] memory p = new uint128[](2);
        p[0] = 50_000 * 1e18;
        p[1] = 150_000 * 1e18;

        vm.prank(oracle);
        priceFeed.setBatchPrices(ids, p);

        (uint256 p1, uint128 u1) = priceFeed.getPrice(cardTypeId1);
        (uint256 p2, uint128 u2) = priceFeed.getPrice(cardTypeId2);
        assertEq(p1, p[0]);
        assertEq(p2, p[1]);
        assertEq(u1, block.timestamp);
        assertEq(u2, block.timestamp);
    }

    function test_RevertIf_SetBatchPrices_LengthMismatch() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cardTypeId1;
        ids[1] = cardTypeId2;

        uint128[] memory p = new uint128[](1);
        p[0] = 50_000 * 1e18;

        vm.prank(oracle);
        vm.expectRevert(HoloFiCardPriceFeed.ArrayLengthMismatch.selector);
        priceFeed.setBatchPrices(ids, p);
    }

    function test_GetPrice_Uninitialized() public view {
        (uint256 price, uint128 lastUpdated) = priceFeed.getPrice(cardTypeId1);
        assertEq(price, 0);
        assertEq(lastUpdated, 0);
    }

    function test_SetPrice_AddsToEnumerableSet() public {
        assertEq(priceFeed.getCardTypesCount(), 0);
        assertFalse(priceFeed.isSupportedCardType(cardTypeId1));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 50_000 * 1e18);

        assertEq(priceFeed.getCardTypesCount(), 1);
        assertTrue(priceFeed.isSupportedCardType(cardTypeId1));
        assertEq(priceFeed.getCardTypeAt(0), cardTypeId1);

        // Setting price again should not duplicate in set
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 60_000 * 1e18);
        assertEq(priceFeed.getCardTypesCount(), 1);
    }

    function test_SetBatchPrices_AddsToEnumerableSet() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cardTypeId1;
        ids[1] = cardTypeId2;

        uint128[] memory p = new uint128[](2);
        p[0] = 50_000 * 1e18;
        p[1] = 150_000 * 1e18;

        vm.prank(oracle);
        priceFeed.setBatchPrices(ids, p);

        assertEq(priceFeed.getCardTypesCount(), 2);
        assertTrue(priceFeed.isSupportedCardType(cardTypeId1));
        assertTrue(priceFeed.isSupportedCardType(cardTypeId2));
        assertEq(priceFeed.getCardTypeAt(0), cardTypeId1);
        assertEq(priceFeed.getCardTypeAt(1), cardTypeId2);
    }

    function test_RevertIf_GetCardTypeAt_OutOfBounds() public {
        vm.expectRevert();
        priceFeed.getCardTypeAt(0);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 50_000 * 1e18);

        vm.expectRevert();
        priceFeed.getCardTypeAt(1);
    }

    function test_IsSupportedCardType() public {
        assertFalse(priceFeed.isSupportedCardType(cardTypeId1));
        assertFalse(priceFeed.isSupportedCardType(cardTypeId2));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 50_000 * 1e18);

        assertTrue(priceFeed.isSupportedCardType(cardTypeId1));
        assertFalse(priceFeed.isSupportedCardType(cardTypeId2));
    }

    function test_GetAllCardTypes() public {
        bytes32[] memory allEmpty = priceFeed.getAllCardTypes();
        assertEq(allEmpty.length, 0);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cardTypeId1;
        ids[1] = cardTypeId2;

        uint128[] memory p = new uint128[](2);
        p[0] = 50_000 * 1e18;
        p[1] = 150_000 * 1e18;

        vm.prank(oracle);
        priceFeed.setBatchPrices(ids, p);

        bytes32[] memory all = priceFeed.getAllCardTypes();
        assertEq(all.length, 2);
        assertEq(all[0], cardTypeId1);
        assertEq(all[1], cardTypeId2);
    }
}
