// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiDutchAuction } from "./HoloFiDutchAuction.sol";

contract HoloFiDutchAuctionTest is Test {
    AccessControlManager public acm;
    HoloFiCardCollection public cardCollection;
    HoloFiLendingPoolFactory public poolFactory;
    HoloFiVaultLoanCore public loanCore;
    HoloFiDutchAuction public dutchAuction;

    address public admin = address(0x1111);
    address public unauthorized = address(0x9999);

    function setUp() public {
        acm = new AccessControlManager(admin);
        cardCollection = new HoloFiCardCollection("HoloFi TCG Cards", "HFC", address(acm));
        poolFactory = new HoloFiLendingPoolFactory(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(cardCollection), address(poolFactory));
        dutchAuction = new HoloFiDutchAuction(address(acm), address(loanCore), address(poolFactory));

        vm.prank(admin);
        loanCore.setDutchAuction(address(dutchAuction));
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(dutchAuction.acm()), address(acm));
        assertEq(address(dutchAuction.loanCore()), address(loanCore));
        assertEq(address(dutchAuction.poolFactory()), address(poolFactory));
        assertEq(loanCore.dutchAuction(), address(dutchAuction));
    }

    function test_RevertIf_Constructor_ZeroAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressACM.selector));
        new HoloFiDutchAuction(address(0), address(loanCore), address(poolFactory));

        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressLoanCore.selector));
        new HoloFiDutchAuction(address(acm), address(0), address(poolFactory));

        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressPoolFactory.selector));
        new HoloFiDutchAuction(address(acm), address(loanCore), address(0));
    }

    function test_SetDutchAuction_Success() public {
        vm.prank(admin);
        loanCore.setDutchAuction(address(0x1234));
        assertEq(loanCore.dutchAuction(), address(0x1234));
    }

    function test_RevertIf_SetDutchAuction_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnauthorizedAdmin.selector, unauthorized));
        loanCore.setDutchAuction(address(0x1234));
    }
}
