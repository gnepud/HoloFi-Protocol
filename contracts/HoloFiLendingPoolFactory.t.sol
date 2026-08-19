// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract HoloFiLendingPoolFactoryTest is Test {
    AccessControlManager public acm;
    HoloFiLendingPoolFactory public factory;
    MockERC20 public eurc;
    MockERC20 public weth;

    address public admin = address(0x1111);
    address public user = address(0x3333);

    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);

    function setUp() public {
        acm = new AccessControlManager(admin);
        factory = new HoloFiLendingPoolFactory(address(acm));
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(factory.acm()), address(acm));
        assertEq(factory.allPoolsLength(), 0);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPoolFactory.ZeroAddressACM.selector));
        new HoloFiLendingPoolFactory(address(0));
    }

    function test_CreatePool_AdminSuccess() public {
        vm.prank(admin);
        address poolAddr = factory.createPool(IERC20(address(eurc)), "Premium Pool EURC", "pEURC", 5000, 7000, 1000, 500);

        assertTrue(poolAddr != address(0));
        assertEq(factory.getPool(address(eurc)), poolAddr);
        assertEq(factory.allPools(0), poolAddr);
        assertEq(factory.allPoolsLength(), 1);
        assertEq(factory.getPoolsByAssetLength(address(eurc)), 1);

        HoloFiLendingPool pool = HoloFiLendingPool(poolAddr);
        assertEq(address(pool.asset()), address(eurc));
        assertEq(pool.name(), "Premium Pool EURC");
        assertEq(pool.symbol(), "pEURC");
        assertEq(pool.maxLtvBps(), 5000);
        assertEq(pool.liquidationThresholdBps(), 7000);
        assertEq(pool.liquidationPenaltyBps(), 1000);
        assertEq(pool.borrowRateBpsPerYear(), 500);
    }

    function test_CreateMultiplePools_SameAssetSuccess() public {
        vm.startPrank(admin);
        address premiumPoolAddr = factory.createPool(IERC20(address(eurc)), "Premium Pool EURC", "pEURC", 5000, 7000, 1000, 500);
        address deluxePoolAddr = factory.createPool(IERC20(address(eurc)), "Deluxe Pool EURC", "dEURC", 4000, 7000, 1000, 800);
        vm.stopPrank();

        assertTrue(premiumPoolAddr != deluxePoolAddr);
        assertEq(factory.getPool(address(eurc)), premiumPoolAddr); // First pool is default lookup
        assertEq(factory.getPoolsByAssetLength(address(eurc)), 2);
        assertEq(factory.allPoolsLength(), 2);

        address[] memory eurcPools = factory.getPoolsByAsset(address(eurc));
        assertEq(eurcPools.length, 2);
        assertEq(eurcPools[0], premiumPoolAddr);
        assertEq(eurcPools[1], deluxePoolAddr);

        assertTrue(factory.isValidPool(premiumPoolAddr));
        assertTrue(factory.isValidPool(deluxePoolAddr));

        HoloFiLendingPool deluxePool = HoloFiLendingPool(deluxePoolAddr);
        assertEq(deluxePool.name(), "Deluxe Pool EURC");
        assertEq(deluxePool.symbol(), "dEURC");
        assertEq(deluxePool.maxLtvBps(), 4000);
        assertEq(deluxePool.borrowRateBpsPerYear(), 800);
    }

    function test_RevertIf_UnauthorizedCreatePool() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiLendingPoolFactory.UnauthorizedOperator.selector, user)
        );
        factory.createPool(IERC20(address(eurc)), "Premium Pool EURC", "pEURC", 5000, 7000, 1000, 500);
    }

    function test_RevertIf_CreatePool_ZeroAddressAsset() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPoolFactory.ZeroAddressAsset.selector));
        factory.createPool(IERC20(address(0)), "Premium Pool EURC", "pEURC", 5000, 7000, 1000, 500);
    }

    function test_CreatePool_SetsIsValidPool() public {
        vm.prank(admin);
        address pool = factory.createPool(IERC20(address(eurc)), "Pool EURC", "pEURC", 5000, 7000, 1000, 500);

        assertTrue(factory.isValidPool(pool));
    }

    function test_IsValidPool_UnregisteredPool() public view {
        assertFalse(factory.isValidPool(address(0x9999)));
    }
}
