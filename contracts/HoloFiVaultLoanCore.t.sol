// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiCardPriceFeed } from "./HoloFiCardPriceFeed.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { GradeEligibilityPolicy } from "./policies/GradeEligibilityPolicy.sol";
import { ICardEligibilityPolicy } from "./interfaces/ICardEligibilityPolicy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract HoloFiVaultLoanCoreTest is Test, IERC721Receiver {
    AccessControlManager public acm;
    HoloFiVaultCard public vaultCard;
    HoloFiLendingPoolFactory public poolFactory;
    HoloFiCardPriceFeed public priceFeed;
    HoloFiVaultLoanCore public loanCore;
    MockERC20 public eurc;
    HoloFiLendingPool public pool;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public store = address(0x3333);
    address public unauthorized = address(0x4444);
    address public oracle = address(0x5555);

    bytes32 public cardTypeId1 = keccak256("Pikachu");
    bytes32 public cardTypeId2 = keccak256("Charizard");

    uint256 public cardId1;
    uint256 public cardId2;

    event VaultCreated(uint256 indexed vaultId, address indexed owner, address indexed lendingPool);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function setUp() public {
        acm = new AccessControlManager(admin);
        vaultCard = new HoloFiVaultCard("HoloFi TCG Cards", "HFC", address(acm));
        poolFactory = new HoloFiLendingPoolFactory(address(acm));
        priceFeed = new HoloFiCardPriceFeed(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(vaultCard), address(poolFactory), address(priceFeed));

        eurc = new MockERC20("Euro Coin", "EURC", 6);

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);
        acm.grantRole(acm.ORACLE_ROLE(), oracle);
        acm.grantRole(acm.ADMIN_ROLE(), address(loanCore));
        acm.setKybStatus(store, true);

        pool = HoloFiLendingPool(
            poolFactory.createPool(
                IERC20(address(eurc)),
                "HoloFi Pool EURC",
                "pEURC",
                5000,
                7000,
                1000,
                500
            )
        );
        pool.setLoanCore(address(loanCore));
        vm.stopPrank();

        bytes32 attestationHash1 = keccak256("raw_data_1");
        bytes32 attestationHash2 = keccak256("raw_data_2");
        vm.startPrank(minter);
        cardId1 = vaultCard.mintCard(store, cardTypeId1, attestationHash1, "ipfs://card1");
        cardId2 = vaultCard.mintCard(store, cardTypeId2, attestationHash2, "ipfs://card2");
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(loanCore.acm()), address(acm));
        assertEq(address(loanCore.vaultCard()), address(vaultCard));
        assertEq(address(loanCore.poolFactory()), address(poolFactory));
        assertEq(address(loanCore.priceFeed()), address(priceFeed));
        assertEq(loanCore.nextVaultId(), 1);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressACM.selector));
        new HoloFiVaultLoanCore(address(0), address(vaultCard), address(poolFactory), address(priceFeed));
    }

    function test_RevertIf_Constructor_ZeroAddressVaultCard() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressVaultCard.selector));
        new HoloFiVaultLoanCore(address(acm), address(0), address(poolFactory), address(priceFeed));
    }

    function test_RevertIf_Constructor_ZeroAddressPoolFactory() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressPoolFactory.selector));
        new HoloFiVaultLoanCore(address(acm), address(vaultCard), address(0), address(priceFeed));
    }

    function test_RevertIf_Constructor_ZeroAddressPriceFeed() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressPriceFeed.selector));
        new HoloFiVaultLoanCore(address(acm), address(vaultCard), address(poolFactory), address(0));
    }

    function test_RevertIf_CreateVault_UnregisteredLendingPool() public {
        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnregisteredLendingPool.selector, address(0x9999)));
        loanCore.createVault(address(0x9999));
    }

    function test_CreateVault_KybApprovedSuccess() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        assertEq(vaultId, 1);
        assertEq(loanCore.nextVaultId(), 2);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.vaultId, 1);
        assertEq(vault.owner, store);
        assertEq(vault.lendingPool, address(pool));
        assertEq(vault.principalDebt, 0);
        assertEq(vault.accumulatedInterest, 0);
        assertTrue(vault.status == HoloFiVaultLoanCore.VaultStatus.Active);
    }

    function test_RevertIf_CreateVault_NonKyb() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.KybRequired.selector, unauthorized));
        loanCore.createVault(address(pool));
    }

    function test_DepositCollateral_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        assertEq(vaultCard.ownerOf(cardId1), address(loanCore));
        assertEq(vaultCard.ownerOf(cardId2), address(loanCore));

        HoloFiVaultCard.CardMetadata memory card1 = vaultCard.getCard(cardId1);
        HoloFiVaultCard.CardMetadata memory card2 = vaultCard.getCard(cardId2);
        assertTrue(card1.isLocked);
        assertTrue(card2.isLocked);

        assertEq(loanCore.nftVaultId(cardId1), vaultId);
        assertEq(loanCore.nftVaultId(cardId2), vaultId);

        uint256[] memory vaultTokens = loanCore.getVaultTokenIds(vaultId);
        assertEq(vaultTokens.length, 2);
        assertEq(vaultTokens[0], cardId1);
        assertEq(vaultTokens[1], cardId2);
    }

    function test_RevertIf_DepositCollateral_UnauthorizedOwner() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.depositCollateral(vaultId, tokenIds);
    }

    function test_WithdrawCollateral_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(store);
        loanCore.withdrawCollateral(vaultId, withdrawTokens);

        assertEq(vaultCard.ownerOf(cardId1), store);
        HoloFiVaultCard.CardMetadata memory card1 = vaultCard.getCard(cardId1);
        assertFalse(card1.isLocked);
        assertEq(loanCore.nftVaultId(cardId1), 0);

        uint256[] memory remainingTokens = loanCore.getVaultTokenIds(vaultId);
        assertEq(remainingTokens.length, 1);
        assertEq(remainingTokens[0], cardId2);
    }

    function test_RevertIf_WithdrawCollateral_NonVaultToken() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiVaultLoanCore.TokenNotInVault.selector, cardId1, vaultId)
        );
        loanCore.withdrawCollateral(vaultId, withdrawTokens);
    }

    function test_CustomPoolRiskParametersPerVault() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        vm.prank(admin);
        HoloFiLendingPool poolCustom = HoloFiLendingPool(
            poolFactory.createPool(IERC20(address(usdc)), "Pool USDC", "pUSDC", 6000, 8000, 1500, 1000)
        );

        vm.startPrank(store);
        uint256 vault1 = loanCore.createVault(address(pool));
        uint256 vault2 = loanCore.createVault(address(poolCustom));
        vm.stopPrank();

        uint256 fmv = 10_000 * 1e18;
        assertEq(loanCore.getMaxBorrowCapacity(vault1, fmv), 5_000 * 1e6); // 50% LTV
        assertEq(loanCore.getMaxBorrowCapacity(vault2, fmv), 6_000 * 1e6); // 60% LTV
    }

    function test_GetMaxBorrowCapacity() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));
        uint256 fmv = 10_000 * 1e18; // $10,000 USD
        uint256 maxBorrow = loanCore.getMaxBorrowCapacity(vaultId, fmv);
        assertEq(maxBorrow, 5_000 * 1e6); // 50% LTV = $5,000 EURC
    }

    function test_GetHealthFactor_ZeroDebt() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));
        uint256 hf = loanCore.getHealthFactor(vaultId, 10_000 * 1e18);
        assertEq(hf, type(uint256).max);
    }

    function test_GetHealthFactor_AboveAndBelowOne() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));
        uint256 fmv = 10_000 * 1e6;

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = cardId1;
        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokens);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e18);

        eurc.mint(address(pool), 100_000 * 1e6);

        // Safe debt = $5,000 -> HF = (10,000 * 0.7) / 5,000 = 1.4
        vm.prank(store);
        loanCore.borrow(vaultId, 5_000 * 1e6);
        assertEq(loanCore.getHealthFactor(vaultId, 10_000 * 1e18), 1.4e18);

        // Undercollateralized FMV = $6,250 -> LT=70% -> HF = (6,250 * 0.7) / 5,000 = 0.875
        assertEq(loanCore.getHealthFactor(vaultId, 6_250 * 1e18), 0.875e18);
    }

    function test_AccrueInterest_TimeWarp() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = cardId1;
        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokens);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 30_000 * 1e18);

        eurc.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 10_000 * 1e6);

        // Warp time by 1 year (365 days)
        vm.warp(block.timestamp + 365 days);

        // Pending interest should be 5% of 10,000 EURC = 500 EURC
        uint256 pending = loanCore.getPendingInterest(vaultId);
        assertEq(pending, 500 * 1e6);

        // Accrue interest
        loanCore.accrueInterest(vaultId);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.accumulatedInterest, 500 * 1e6);
        assertEq(loanCore.getPendingInterest(vaultId), 0);
        assertEq(loanCore.getTotalDebt(vaultId), 10_500 * 1e6);
    }

    function test_SetCardPrice_Success() public {
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e18);
        (uint256 price, ) = priceFeed.getPrice(cardTypeId1);
        assertEq(price, 5_000 * 1e18);
    }

    function test_SetBatchCardPrices_Success() public {
        bytes32[] memory cardTypeIds = new bytes32[](2);
        cardTypeIds[0] = cardTypeId1;
        cardTypeIds[1] = cardTypeId2;

        uint128[] memory fmvs = new uint128[](2);
        fmvs[0] = 6_000 * 1e18;
        fmvs[1] = 4_000 * 1e18;

        vm.prank(oracle);
        priceFeed.setBatchPrices(cardTypeIds, fmvs);

        (uint256 price1, ) = priceFeed.getPrice(cardTypeId1);
        (uint256 price2, ) = priceFeed.getPrice(cardTypeId2);
        assertEq(price1, 6_000 * 1e18);
        assertEq(price2, 4_000 * 1e18);
    }

    function test_RevertIf_SetCardPrice_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardPriceFeed.UnauthorizedOracle.selector, unauthorized));
        priceFeed.setPrice(cardTypeId1, 5_000 * 1e18);
    }

    function test_RevertIf_SetBatchCardPrices_LengthMismatch() public {
        bytes32[] memory cardTypeIds = new bytes32[](2);
        cardTypeIds[0] = cardTypeId1;
        cardTypeIds[1] = cardTypeId2;

        uint128[] memory fmvs = new uint128[](1);
        fmvs[0] = 6_000 * 1e18;

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardPriceFeed.ArrayLengthMismatch.selector));
        priceFeed.setBatchPrices(cardTypeIds, fmvs);
    }

    function test_GetVaultFMV() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        priceFeed.setPrice(cardTypeId1, 6_000 * 1e18);
        priceFeed.setPrice(cardTypeId2, 4_000 * 1e18);
        vm.stopPrank();

        assertEq(loanCore.getVaultFMV(vaultId), 10_000 * 1e18);
    }

    function test_Borrow_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e18);

        eurc.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 4_000 * 1e6);
        assertEq(eurc.balanceOf(store), 4_000 * 1e6);
    }

    function test_RevertIf_Borrow_ExceedsMaxBorrowCapacity() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e18);

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.ExceedsMaxBorrowCapacity.selector,
                vaultId,
                6_000 * 1e6,
                5_000 * 1e6
            )
        );
        loanCore.borrow(vaultId, 6_000 * 1e6);
    }

    function test_RevertIf_Borrow_UnauthorizedOwner() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.borrow(vaultId, 1_000 * 1e6);
    }

    function test_RevertIf_Borrow_ZeroAmount() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroBorrowAmount.selector));
        loanCore.borrow(vaultId, 0);
    }

    function test_Repay_PartialInterestAndPrincipal() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e18);

        eurc.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6);

        // Warp 1 year -> $200 interest accrued (5% of 4,000)
        vm.warp(block.timestamp + 365 days);

        // Mint asset to store to repay $1,200 ($200 interest + $1,000 principal)
        eurc.mint(store, 1_200 * 1e6);

        vm.startPrank(store);
        eurc.approve(address(pool), 1_200 * 1e6);
        loanCore.repay(vaultId, 1_200 * 1e6);
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.accumulatedInterest, 0);
        assertEq(vault.principalDebt, 3_000 * 1e6);
    }

    function test_Repay_FullLoanSettlementAndCollateralRelease() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e18);

        eurc.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6);

        vm.warp(block.timestamp + 365 days); // $200 interest accrued

        // Repay $5,000 (total debt = $4,200, overpayment capped at $4,200)
        eurc.mint(store, 5_000 * 1e6);

        vm.startPrank(store);
        eurc.approve(address(pool), 5_000 * 1e6);
        loanCore.repay(vaultId, 5_000 * 1e6);
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 0);
        assertEq(vault.accumulatedInterest, 0);

        // Withdraw collateral back to store
        vm.prank(store);
        loanCore.withdrawCollateral(vaultId, tokenIds);

        assertEq(vaultCard.ownerOf(cardId1), store);
    }

    function test_RevertIf_Repay_ZeroAmount() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroRepayAmount.selector));
        loanCore.repay(vaultId, 0);
    }

    function test_RevertIf_Repay_NoActiveDebt() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.NoActiveDebt.selector, vaultId));
        loanCore.repay(vaultId, 1_000 * 1e6);
    }

    function test_WithdrawCollateral_PartialExcessCollateral() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        priceFeed.setPrice(cardTypeId1, 6_000 * 1e18);
        priceFeed.setPrice(cardTypeId2, 4_000 * 1e18);
        vm.stopPrank();

        eurc.mint(address(pool), 100_000 * 1e6);

        // Borrow $3,000 (total FMV = $10,000, max borrow = $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 3_000 * 1e6);

        // Withdraw cardId2 ($4,000 FMV). Remaining FMV = $6,000 (max borrow = $3,000). Debt = $3,000 -> succeeds
        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId2;

        vm.prank(store);
        loanCore.withdrawCollateral(vaultId, withdrawTokens);

        assertEq(vaultCard.ownerOf(cardId2), store);
    }

    function test_RevertIf_WithdrawCollateral_InsufficientCollateralRatio() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        priceFeed.setPrice(cardTypeId1, 6_000 * 1e18);
        priceFeed.setPrice(cardTypeId2, 4_000 * 1e18);
        vm.stopPrank();

        eurc.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (total FMV = $10,000, max borrow = $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6);

        // Attempt to withdraw cardId1 ($6,000 FMV). Remaining FMV = $4,000 (max borrow = $2,000). Debt = $4,000 -> reverts
        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.InsufficientCollateralRatio.selector,
                vaultId,
                4_000 * 1e6,
                2_000 * 1e6
            )
        );
        loanCore.withdrawCollateral(vaultId, withdrawTokens);
    }

    function test_RepayAndWithdraw_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        priceFeed.setPrice(cardTypeId1, 6_000 * 1e18);
        priceFeed.setPrice(cardTypeId2, 4_000 * 1e18);
        vm.stopPrank();

        eurc.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6);

        eurc.mint(store, 2_000 * 1e6);

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.startPrank(store);
        eurc.approve(address(pool), 2_000 * 1e6);
        loanCore.repayAndWithdraw(vaultId, 2_000 * 1e6, withdrawTokens);
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 2_000 * 1e6);
        assertEq(vaultCard.ownerOf(cardId1), store);
    }

    function test_RevertIf_RepayAndWithdraw_Unauthorized() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.repayAndWithdraw(vaultId, 0, withdrawTokens);
    }

    function test_DepositCollateral_WithEligibilityPolicy_Success() public {
        GradeEligibilityPolicy policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 0);

        vm.prank(admin);
        pool.setEligibilityPolicy(address(policy));

        ICardEligibilityPolicy.CardAttributes memory psa10 = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base",
            cardName: "Pikachu",
            cardNumber: "25/102",
            printing: "1st",
            grader: "PSA",
            grade: "10"
        });

        vm.prank(minter);
        (bytes32 cardTypeId, ) = policy.registerCardType(psa10);

        uint256 eligibleTokenId;
        vm.prank(minter);
        eligibleTokenId = vaultCard.mintCard(store, cardTypeId, keccak256("raw_data_eligible"), "ipfs://eligible");

        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = eligibleTokenId;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        assertEq(vaultCard.ownerOf(eligibleTokenId), address(loanCore));
        assertEq(loanCore.nftVaultId(eligibleTokenId), vaultId);
    }

    function test_RevertIf_DepositCollateral_IneligibleCollateral() public {
        GradeEligibilityPolicy policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 0);

        vm.prank(admin);
        pool.setEligibilityPolicy(address(policy));

        ICardEligibilityPolicy.CardAttributes memory psa9 = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base",
            cardName: "Charizard",
            cardNumber: "4/102",
            printing: "1st",
            grader: "PSA",
            grade: "9"
        });

        vm.prank(minter);
        (bytes32 ineligibleCardTypeId, ) = policy.registerCardType(psa9);

        uint256 ineligibleTokenId;
        vm.prank(minter);
        ineligibleTokenId = vaultCard.mintCard(store, ineligibleCardTypeId, keccak256("raw_data_ineligible"), "ipfs://ineligible");

        vm.prank(store);
        uint256 vaultId = loanCore.createVault(address(pool));

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = ineligibleTokenId;

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.IneligibleCollateral.selector,
                ineligibleTokenId,
                ineligibleCardTypeId,
                address(pool)
            )
        );
        loanCore.depositCollateral(vaultId, tokenIds);
    }

    function test_C02_MultiDecimalPoolBorrowAndHealthFactor() public {
        // Test 18-decimal oracle price ($10,000 USD) across:
        // 1. EURC (6 decimals)
        // 2. DAI / WETH (18 decimals)
        // 3. WBTC (8 decimals)

        // 1. Setup 18-decimal token pool (e.g. DAI)
        MockERC20 dai = new MockERC20("Dai Stablecoin", "DAI", 18);
        vm.prank(admin);
        poolFactory.createPool(dai, "Pool DAI", "pDAI", 5000, 7000, 1000, 500);
        HoloFiLendingPool daiPool = HoloFiLendingPool(poolFactory.getPool(address(dai)));
        vm.prank(admin);
        daiPool.setLoanCore(address(loanCore));
        dai.mint(address(daiPool), 1_000_000 * 1e18);

        // 2. Setup 8-decimal token pool (e.g. WBTC)
        MockERC20 wbtc = new MockERC20("Wrapped BTC", "WBTC", 8);
        vm.prank(admin);
        poolFactory.createPool(wbtc, "Pool WBTC", "pWBTC", 5000, 7000, 1000, 500);
        HoloFiLendingPool wbtcPool = HoloFiLendingPool(poolFactory.getPool(address(wbtc)));
        vm.prank(admin);
        wbtcPool.setLoanCore(address(loanCore));
        wbtc.mint(address(wbtcPool), 1_000_000 * 1e8);

        // Oracle sets 18-decimal USD price for cardTypeId1 = $10,000 USD
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, 10_000 * 1e18);

        // --- Test EURC (6 decimals) ---
        vm.prank(store);
        uint256 eurcVaultId = loanCore.createVault(address(pool));
        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);
        uint256[] memory tokensEurc = new uint256[](1);
        tokensEurc[0] = cardId1;
        vm.prank(store);
        loanCore.depositCollateral(eurcVaultId, tokensEurc);

        eurc.mint(address(pool), 1_000_000 * 1e6);

        // 50% LTV on $10,000 USD = 5,000 EURC (6 decimals)
        assertEq(loanCore.getMaxBorrowCapacity(eurcVaultId, 10_000 * 1e18), 5_000 * 1e6);
        vm.prank(store);
        loanCore.borrow(eurcVaultId, 5_000 * 1e6);
        // Health factor: (5,000 normalized * 70%) / 5,000 debt = 1.4e18
        assertEq(loanCore.getHealthFactor(eurcVaultId, 10_000 * 1e18), 1.4e18);

        // --- Test DAI (18 decimals) ---
        vm.prank(minter);
        uint256 cardId3 = vaultCard.mintCard(store, cardTypeId1, keccak256("raw_data_3"), "ipfs://card3");
        vm.prank(store);
        uint256 daiVaultId = loanCore.createVault(address(daiPool));
        uint256[] memory tokensDai = new uint256[](1);
        tokensDai[0] = cardId3;
        vm.prank(store);
        loanCore.depositCollateral(daiVaultId, tokensDai);

        // 50% LTV on $10,000 USD = 5,000 DAI (18 decimals)
        assertEq(loanCore.getMaxBorrowCapacity(daiVaultId, 10_000 * 1e18), 5_000 * 1e18);
        vm.prank(store);
        loanCore.borrow(daiVaultId, 5_000 * 1e18);
        assertEq(loanCore.getHealthFactor(daiVaultId, 10_000 * 1e18), 1.4e18);

        // --- Test WBTC (8 decimals) ---
        vm.prank(minter);
        uint256 cardId4 = vaultCard.mintCard(store, cardTypeId1, keccak256("raw_data_4"), "ipfs://card4");
        vm.prank(store);
        uint256 wbtcVaultId = loanCore.createVault(address(wbtcPool));
        uint256[] memory tokensWbtc = new uint256[](1);
        tokensWbtc[0] = cardId4;
        vm.prank(store);
        loanCore.depositCollateral(wbtcVaultId, tokensWbtc);

        // 50% LTV on $10,000 USD = 5,000 WBTC (8 decimals)
        assertEq(loanCore.getMaxBorrowCapacity(wbtcVaultId, 10_000 * 1e18), 5_000 * 1e8);
        vm.prank(store);
        loanCore.borrow(wbtcVaultId, 5_000 * 1e8);
        assertEq(loanCore.getHealthFactor(wbtcVaultId, 10_000 * 1e18), 1.4e18);
    }
}
