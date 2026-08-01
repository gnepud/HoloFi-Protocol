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
    address public oracle = address(0x2222);
    address public user = address(0x3333);

    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);

    function setUp() public {
        acm = new AccessControlManager(admin);
        factory = new HoloFiLendingPoolFactory(address(acm));
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);

        bytes32 oracleRole = acm.ORACLE_ROLE();
        vm.prank(admin);
        acm.grantRole(oracleRole, oracle);
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
        address poolAddr = factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");

        assertTrue(poolAddr != address(0));
        assertEq(factory.getPool(address(eurc)), poolAddr);
        assertEq(factory.allPools(0), poolAddr);
        assertEq(factory.allPoolsLength(), 1);

        HoloFiLendingPool pool = HoloFiLendingPool(poolAddr);
        assertEq(address(pool.asset()), address(eurc));
        assertEq(pool.name(), "HoloFi Pool EURC");
        assertEq(pool.symbol(), "pEURC");
    }

    function test_CreatePool_OracleSuccess() public {
        vm.prank(oracle);
        address poolAddr = factory.createPool(IERC20(address(weth)), "HoloFi Pool WETH", "pWETH");

        assertEq(factory.getPool(address(weth)), poolAddr);
        assertEq(factory.allPoolsLength(), 1);
    }

    function test_RevertIf_UnauthorizedCreatePool() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiLendingPoolFactory.UnauthorizedOperator.selector, user)
        );
        factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");
    }

    function test_RevertIf_CreatePool_ZeroAddressAsset() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPoolFactory.ZeroAddressAsset.selector));
        factory.createPool(IERC20(address(0)), "HoloFi Pool EURC", "pEURC");
    }

    function test_RevertIf_CreatePool_AlreadyExists() public {
        vm.prank(admin);
        address existingPool = factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiLendingPoolFactory.PoolAlreadyExists.selector,
                address(eurc),
                existingPool
            )
        );
        factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");
    }
}
