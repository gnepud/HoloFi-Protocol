// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiDutchAuction } from "./HoloFiDutchAuction.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiCardPriceFeed } from "./HoloFiCardPriceFeed.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockDutchAuction is HoloFiDutchAuction {
    uint256 public mockPrice;

    constructor(address _acm, address _loanCore, address _poolFactory)
        HoloFiDutchAuction(_acm, _loanCore, _poolFactory) {}

    function setMockPrice(uint256 price) external {
        mockPrice = price;
    }

    function getAuctionPrice(uint256 vaultId) public view override returns (uint256) {
        if (mockPrice > 0) return mockPrice;
        return super.getAuctionPrice(vaultId);
    }
}

contract HoloFiDutchAuctionTest is Test {
    AccessControlManager public acm;
    HoloFiVaultCard public vaultCard;
    HoloFiLendingPoolFactory public poolFactory;
    HoloFiCardPriceFeed public priceFeed;
    HoloFiVaultLoanCore public loanCore;
    HoloFiDutchAuction public dutchAuction;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public store = address(0x3333);
    address public unauthorized = address(0x9999);
    address public oracle = address(0x5555);

    bytes32 public cardTypeId1 = keccak256("Pikachu");
    bytes32 public cardTypeId2 = keccak256("Charizard");

    uint256 public cardId1;
    uint256 public cardId2;

    function setUp() public {
        acm = new AccessControlManager(admin);
        vaultCard = new HoloFiVaultCard("HoloFi TCG Cards", "HFC", address(acm));
        poolFactory = new HoloFiLendingPoolFactory(address(acm));
        priceFeed = new HoloFiCardPriceFeed(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(vaultCard), address(poolFactory), address(priceFeed));
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
        cardId1 = vaultCard.mintCard(store, cardTypeId1, attestationHash1, "ipfs://card1");
        cardId2 = vaultCard.mintCard(store, cardTypeId2, attestationHash2, "ipfs://card2");
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
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

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
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        HoloFiDutchAuction.Auction memory auction = dutchAuction.getAuction(vaultId);
        assertEq(auction.startFmv, 5_000 * 1e6);
        assertEq(auction.startPrice, 6_000 * 1e6); // 120% of $5,000
        assertEq(auction.debtAmount, 4_000 * 1e6);
        assertEq(auction.penaltyAmount, 400 * 1e6); // 10% of $4,000 = $400
        assertEq(auction.reservePrice, 4_400 * 1e6); // total debt $4,000 + penalty $400 = $4,400
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Liquidating));
    }

    function test_StartAuction_IncludesLiquidationPenalty() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (total FMV = $10,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Drop FMV to $5,000 -> HF = 3,500 / 4,000 = 0.875 < 1.0
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        HoloFiDutchAuction.Auction memory auction = dutchAuction.getAuction(vaultId);
        assertEq(auction.debtAmount, 4_000 * 1e6);
        assertEq(auction.penaltyAmount, 400 * 1e6); // 10% of $4,000 = $400
        assertEq(auction.reservePrice, 4_400 * 1e6); // $4,000 + $400 = $4,400
        assertEq(auction.startPrice, 6_000 * 1e6);
    }

    function test_RevertIf_StartAuction_HealthyVault() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

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
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // t = 0 -> startPrice $6,000
        assertEq(dutchAuction.getAuctionPrice(vaultId), 6_000 * 1e6);

        // t = 24h (midpoint) -> startPrice $6,000 - ($1,600 * 24 / 48) = $5,200
        vm.warp(block.timestamp + 24 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 5_200 * 1e6);

        // t = 48h (duration end) -> reservePrice $4,400
        vm.warp(block.timestamp + 24 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 4_400 * 1e6);

        // t = 60h (> duration end) -> reservePrice $4,400
        vm.warp(block.timestamp + 12 hours);
        assertEq(dutchAuction.getAuctionPrice(vaultId), 4_400 * 1e6);
    }

    function test_SettleAuction_WithSurplus() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (total FMV = $10,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        // Drop FMV to $5,000 -> HF = 3,500 / 4,000 = 0.875 < 1.0
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // StartPrice = $6,000, ReservePrice = $4,400. Time warp 24h -> CurrentPrice = $5,200 (debt = $4,000, penalty = $400, surplus = $800)
        vm.warp(block.timestamp + 24 hours);

        address liquidator = address(0x8888);
        asset.mint(liquidator, 6_000 * 1e6);

        vm.startPrank(liquidator);
        asset.approve(address(dutchAuction), 5_200 * 1e6);

        dutchAuction.settleAuction(vaultId, address(pool));
        vm.stopPrank();

        // Verifications
        assertEq(asset.balanceOf(store), 4_800 * 1e6); // Store borrowed $4,000 + receives $800 surplus = $4,800
        assertEq(asset.balanceOf(address(pool)), 100_400 * 1e6); // Pool 100,000 + 400 penalty
        assertEq(vaultCard.ownerOf(cardId1), liquidator); // Liquidator receives card NFT
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Closed));
        assertEq(loanCore.getVault(vaultId).principalDebt, 0);
    }

    function test_SettleAuction_SingleApprovalWaterfallDistribution() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // StartPrice = $6,000, ReservePrice = $4,400 (debt = $4,000, penalty = $400).
        // Time warp 24h -> CurrentPrice = $5,200 ($6,000 - ($1,600 * 24 / 48) = $5,200)
        // Surplus = $5,200 - $4,400 = $800
        vm.warp(block.timestamp + 24 hours);

        address liquidator = address(0x8888);
        asset.mint(liquidator, 6_000 * 1e6);

        // Liquidator approves ONLY dutchAuction for currentPrice ($5,200)
        vm.startPrank(liquidator);
        asset.approve(address(dutchAuction), 5_200 * 1e6);

        dutchAuction.settleAuction(vaultId, address(pool));
        vm.stopPrank();

        // Assertions
        assertEq(asset.balanceOf(address(pool)), 100_400 * 1e6); // $100,000 principal + $400 penalty
        assertEq(asset.balanceOf(store), 4_800 * 1e6); // Store receives $800 surplus refund (4,000 borrowed + 800)
        assertEq(vaultCard.ownerOf(cardId1), liquidator);
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Closed));
    }

    function test_SettleAuction_AtReservePrice() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // Time warp 48h -> CurrentPrice = ReservePrice = $4,400 (surplus = 0)
        vm.warp(block.timestamp + 48 hours);

        address liquidator = address(0x8888);
        asset.mint(liquidator, 4_400 * 1e6);

        vm.startPrank(liquidator);
        asset.approve(address(dutchAuction), 4_400 * 1e6);

        dutchAuction.settleAuction(vaultId, address(pool));
        vm.stopPrank();

        assertEq(asset.balanceOf(store), 4_000 * 1e6);
        assertEq(asset.balanceOf(address(pool)), 100_400 * 1e6);
        assertEq(vaultCard.ownerOf(cardId1), liquidator);
    }

    function test_RevertIf_SettleAuction_InsufficientAuctionPrice() public {
        MockDutchAuction mockAuction = new MockDutchAuction(address(acm), address(loanCore), address(poolFactory));
        vm.prank(admin);
        loanCore.setDutchAuction(address(mockAuction));

        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        mockAuction.startAuction(vaultId);

        // Set mock price to 4,000 * 1e6 (less than reservePrice 4,400 * 1e6)
        mockAuction.setMockPrice(4_000 * 1e6);

        address liquidator = address(0x8888);
        asset.mint(liquidator, 6_000 * 1e6);

        vm.startPrank(liquidator);
        asset.approve(address(mockAuction), 6_000 * 1e6);

        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.InsufficientAuctionPrice.selector, 4_000 * 1e6, 4_400 * 1e6));
        mockAuction.settleAuction(vaultId, address(pool));
        vm.stopPrank();
    }

    function test_RevertIf_SettleAuction_UnregisteredPool() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.UnregisteredLendingPool.selector, unauthorized));
        dutchAuction.settleAuction(vaultId, unauthorized);
    }

    function test_SetTreasury_Success() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);
        assertEq(dutchAuction.treasury(), treasury);
    }

    function test_RevertIf_SetTreasury_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.UnauthorizedAdmin.selector, unauthorized));
        dutchAuction.setTreasury(address(0x5555));
    }

    function test_RevertIf_SetTreasury_ZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressTreasury.selector));
        dutchAuction.setTreasury(address(0));
    }

    function test_RevertIf_TreasuryBuyback_UnauthorizedCaller() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.UnauthorizedTreasury.selector, unauthorized));
        dutchAuction.treasuryBuyback(1, address(0x1234));
    }

    function test_RevertIf_TreasuryBuyback_NotExpired() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);

        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // Time warp 24h (only half duration)
        vm.warp(block.timestamp + 24 hours);

        vm.prank(treasury);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiDutchAuction.AuctionNotExpired.selector,
                vaultId,
                block.timestamp,
                block.timestamp + 24 hours
            )
        );
        dutchAuction.treasuryBuyback(vaultId, address(pool));
    }

    function test_TreasuryBuyback_Success() public {
        address treasury = address(0x5555);
        vm.prank(admin);
        dutchAuction.setTreasury(treasury);

        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e6);

        dutchAuction.startAuction(vaultId);

        // Time warp 49h (past 48h expiration)
        vm.warp(block.timestamp + 49 hours);

        asset.mint(treasury, 4_000 * 1e6);

        vm.startPrank(treasury);
        asset.approve(address(dutchAuction), 4_000 * 1e6);

        dutchAuction.treasuryBuyback(vaultId, address(pool));
        vm.stopPrank();

        // Assertions
        assertEq(asset.balanceOf(address(pool)), 100_000 * 1e6); // Exact $4,000 debt restored
        assertEq(vaultCard.ownerOf(cardId1), treasury); // Card NFT assigned to treasury
        assertEq(uint256(loanCore.getVault(vaultId).status), uint256(HoloFiVaultLoanCore.VaultStatus.Closed));
        assertEq(loanCore.getVault(vaultId).principalDebt, 0);
    }
}

