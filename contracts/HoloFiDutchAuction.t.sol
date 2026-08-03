// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiDutchAuction } from "./HoloFiDutchAuction.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract HoloFiDutchAuctionTest is Test {
    AccessControlManager public acm;
    HoloFiCardCollection public cardCollection;
    HoloFiLendingPoolFactory public poolFactory;
    HoloFiVaultLoanCore public loanCore;
    HoloFiDutchAuction public dutchAuction;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public store = address(0x3333);
    address public unauthorized = address(0x9999);
    address public oracle = address(0x5555);

    uint256 public cardId1;
    uint256 public cardId2;

    function setUp() public {
        acm = new AccessControlManager(admin);
        cardCollection = new HoloFiCardCollection("HoloFi TCG Cards", "HFC", address(acm));
        poolFactory = new HoloFiLendingPoolFactory(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(cardCollection), address(poolFactory));
        dutchAuction = new HoloFiDutchAuction(address(acm), address(loanCore), address(poolFactory));

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);
        acm.grantRole(acm.ORACLE_ROLE(), oracle);
        acm.grantRole(acm.ADMIN_ROLE(), address(loanCore));
        acm.setKybStatus(store, true);
        loanCore.setDutchAuction(address(dutchAuction));
        vm.stopPrank();

        bytes32 attestationHash1 = keccak256("raw_data_1");
        bytes32 attestationHash2 = keccak256("raw_data_2");
        vm.startPrank(minter);
        cardId1 = cardCollection.mintCard(store, attestationHash1, "ipfs://card1");
        cardId2 = cardCollection.mintCard(store, attestationHash2, "ipfs://card2");
        vm.stopPrank();
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

    function test_StartAuction_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (FMV $10,000, max borrow $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Oracle drops FMV of cardId1 from $10,000 to $5,000
        // Debt = $4,000, Liquidation threshold = 70% -> max threshold value = $3,500. HF = 3,500 / 4,000 = 0.875 < 1.0
        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        HoloFiDutchAuction.Auction memory auction = dutchAuction.getAuction(vaultId);
        assertEq(auction.startFmv, 5_000 * 1e6);
        assertEq(auction.startPrice, 6_000 * 1e6); // 120% of $5,000
        assertEq(auction.reservePrice, 4_000 * 1e6); // total debt $4,000
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Liquidating));
    }

    function test_RevertIf_StartAuction_HealthyVault() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // HF = (10,000 * 0.7) / 4,000 = 1.75 >= 1.0 -> revert VaultNotEligibleForLiquidation
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.VaultNotEligibleForLiquidation.selector,
                vaultId,
                1750000000000000000
            )
        );
        dutchAuction.startAuction(vaultId);
    }

    function test_GetAuctionPrice_LinearDecay() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // t = 0 -> startPrice $6,000
        assertEq(dutchAuction.getAuctionPrice(vaultId), 6_000 * 1e6);

        // t = 24h (midpoint) -> midpoint between $6,000 and $4,000 is $5,000
        vm.warp(block.timestamp + 24 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 5_000 * 1e6);

        // t = 48h (duration end) -> reservePrice $4,000
        vm.warp(block.timestamp + 24 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 4_000 * 1e6);

        // t = 60h (> duration end) -> reservePrice $4,000
        vm.warp(block.timestamp + 12 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 4_000 * 1e6);
    }
}
