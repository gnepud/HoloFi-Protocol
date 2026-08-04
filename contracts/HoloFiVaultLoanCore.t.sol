// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract HoloFiVaultLoanCoreTest is Test, IERC721Receiver {
    AccessControlManager public acm;
    HoloFiVaultCard public vaultCard;
    HoloFiLendingPoolFactory public poolFactory;
    HoloFiVaultLoanCore public loanCore;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public store = address(0x3333);
    address public unauthorized = address(0x4444);
    address public oracle = address(0x5555);

    uint256 public cardId1;
    uint256 public cardId2;

    event VaultCreated(uint256 indexed vaultId, address indexed owner);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function setUp() public {
        acm = new AccessControlManager(admin);
        vaultCard = new HoloFiVaultCard("HoloFi TCG Cards", "HFC", address(acm));
        poolFactory = new HoloFiLendingPoolFactory(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(vaultCard), address(poolFactory));

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);
        acm.grantRole(acm.ORACLE_ROLE(), oracle);
        acm.grantRole(acm.ADMIN_ROLE(), address(loanCore));
        acm.setKybStatus(store, true);
        vm.stopPrank();

        bytes32 attestationHash1 = keccak256("raw_data_1");
        bytes32 attestationHash2 = keccak256("raw_data_2");
        vm.startPrank(minter);
        cardId1 = vaultCard.mintCard(store, attestationHash1, "ipfs://card1");
        cardId2 = vaultCard.mintCard(store, attestationHash2, "ipfs://card2");
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(loanCore.acm()), address(acm));
        assertEq(address(loanCore.vaultCard()), address(vaultCard));
        assertEq(address(loanCore.poolFactory()), address(poolFactory));
        assertEq(loanCore.nextVaultId(), 1);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressACM.selector));
        new HoloFiVaultLoanCore(address(0), address(vaultCard), address(poolFactory));
    }

    function test_RevertIf_Constructor_ZeroAddressVaultCard() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressVaultCard.selector));
        new HoloFiVaultLoanCore(address(acm), address(0), address(poolFactory));
    }

    function test_RevertIf_Constructor_ZeroAddressPoolFactory() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressPoolFactory.selector));
        new HoloFiVaultLoanCore(address(acm), address(vaultCard), address(0));
    }

    function test_RevertIf_Borrow_UnregisteredLendingPool() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnregisteredLendingPool.selector, address(0x9999)));
        loanCore.borrow(vaultId, 1000 * 1e6, address(0x9999));
    }

    function test_RevertIf_Repay_UnregisteredLendingPool() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnregisteredLendingPool.selector, address(0x9999)));
        loanCore.repay(vaultId, 1000 * 1e6, address(0x9999));
    }

    function test_CreateVault_KybApprovedSuccess() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        assertEq(vaultId, 1);
        assertEq(loanCore.nextVaultId(), 2);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.vaultId, 1);
        assertEq(vault.owner, store);
        assertEq(vault.principalDebt, 0);
        assertEq(vault.accumulatedInterest, 0);
        assertTrue(vault.status == HoloFiVaultLoanCore.VaultStatus.Active);
    }

    function test_RevertIf_CreateVault_NonKyb() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.KybRequired.selector, unauthorized));
        loanCore.createVault();
    }

    function test_DepositCollateral_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

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
        uint256 vaultId = loanCore.createVault();

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
        uint256 vaultId = loanCore.createVault();

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
        uint256 vaultId = loanCore.createVault();

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiVaultLoanCore.TokenNotInVault.selector, cardId1, vaultId)
        );
        loanCore.withdrawCollateral(vaultId, withdrawTokens);
    }

    function test_SetRiskParameters_Success() public {
        vm.prank(admin);
        loanCore.setRiskParameters(4000, 6000, 1500, 600);

        assertEq(loanCore.maxLtvBps(), 4000);
        assertEq(loanCore.liquidationThresholdBps(), 6000);
        assertEq(loanCore.liquidationPenaltyBps(), 1500);
        assertEq(loanCore.borrowRateBpsPerYear(), 600);
    }

    function test_RevertIf_SetRiskParameters_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnauthorizedAdmin.selector, unauthorized));
        loanCore.setRiskParameters(4000, 6000, 1500, 600);
    }

    function test_RevertIf_SetRiskParameters_InvalidParameters() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.InvalidRiskParameters.selector));
        loanCore.setRiskParameters(8000, 7000, 1000, 500); // LTV > Liquidation Threshold
    }

    function test_GetMaxBorrowCapacity() public view {
        uint256 fmv = 10_000 * 1e6; // $10,000 USDC
        uint256 maxBorrow = loanCore.getMaxBorrowCapacity(fmv);
        assertEq(maxBorrow, 5_000 * 1e6); // 50% LTV = $5,000 USDC
    }

    function test_CalculateHealthFactor_ZeroDebt() public view {
        uint256 hf = loanCore.calculateHealthFactor(10_000 * 1e6, 0);
        assertEq(hf, type(uint256).max);
    }

    function test_CalculateHealthFactor_AboveAndBelowOne() public view {
        uint256 fmv = 10_000 * 1e6;
        // Liquidation Threshold = 70% -> Max collateral value for HF=1.0 is $7,000

        // Safe debt = $5,000 -> HF = (10,000 * 0.7) / 5,000 = 1.4
        uint256 safeHf = loanCore.calculateHealthFactor(fmv, 5_000 * 1e6);
        assertEq(safeHf, 1.4e18);

        // Undercollateralized debt = $8,000 -> HF = (10,000 * 0.7) / 8,000 = 0.875
        uint256 unsafeHf = loanCore.calculateHealthFactor(fmv, 8_000 * 1e6);
        assertEq(unsafeHf, 0.875e18);
    }

    function test_AccrueInterest_TimeWarp() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        // Set principalDebt to $10,000 USDC (10_000 * 1e6) via vm.store
        bytes32 baseSlot = keccak256(abi.encode(vaultId, uint256(0)));
        vm.store(address(loanCore), bytes32(uint256(baseSlot) + 3), bytes32(uint256(10_000 * 1e6)));
        vm.store(address(loanCore), bytes32(uint256(baseSlot) + 5), bytes32(uint256(block.timestamp)));

        // Warp time by 1 year (365 days)
        vm.warp(block.timestamp + 365 days);

        // Pending interest should be 5% of 10,000 USDC = 500 USDC
        uint256 pending = loanCore.getPendingInterest(vaultId);
        assertEq(pending, 500 * 1e6);

        // Accrue interest
        loanCore.accrueInterest(vaultId);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.accumulatedInterest, 500 * 1e6);
        assertEq(loanCore.getPendingInterest(vaultId), 0);
        assertEq(loanCore.getTotalDebt(vaultId), 10_500 * 1e6);
    }

    function test_SetCardFmv_Success() public {
        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);
        assertEq(loanCore.cardFmv(cardId1), 5_000 * 1e6);
    }

    function test_SetBatchCardFmv_Success() public {
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        uint256[] memory fmvs = new uint256[](2);
        fmvs[0] = 6_000 * 1e6;
        fmvs[1] = 4_000 * 1e6;

        vm.prank(oracle);
        loanCore.setBatchCardFmv(tokenIds, fmvs);

        assertEq(loanCore.cardFmv(cardId1), 6_000 * 1e6);
        assertEq(loanCore.cardFmv(cardId2), 4_000 * 1e6);
    }

    function test_RevertIf_SetCardFmv_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnauthorizedOracle.selector, unauthorized));
        loanCore.setCardFmv(cardId1, 5_000 * 1e6);
    }

    function test_RevertIf_SetBatchCardFmv_LengthMismatch() public {
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        uint256[] memory fmvs = new uint256[](1);
        fmvs[0] = 6_000 * 1e6;

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ArrayLengthMismatch.selector));
        loanCore.setBatchCardFmv(tokenIds, fmvs);
    }

    function test_GetVaultFMV() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        assertEq(loanCore.getVaultFMV(vaultId), 10_000 * 1e6);
    }

    function test_Borrow_Success() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

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

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 4_000 * 1e6);
        assertEq(asset.balanceOf(store), 4_000 * 1e6);
    }

    function test_RevertIf_Borrow_ExceedsMaxBorrowCapacity() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.prank(oracle);
        loanCore.setCardFmv(cardId1, 10_000 * 1e6);

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(store);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.ExceedsMaxBorrowCapacity.selector,
                vaultId,
                6_000 * 1e6,
                5_000 * 1e6
            )
        );
        loanCore.borrow(vaultId, 6_000 * 1e6, address(pool));
    }

    function test_RevertIf_Borrow_UnauthorizedOwner() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.borrow(vaultId, 1_000 * 1e6, address(pool));
    }

    function test_RevertIf_Borrow_ZeroAmount() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroBorrowAmount.selector));
        loanCore.borrow(vaultId, 0, address(pool));
    }

    function test_Repay_PartialInterestAndPrincipal() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

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

        // Warp 1 year -> $200 interest accrued (5% of 4,000)
        vm.warp(block.timestamp + 365 days);

        // Mint asset to store to repay $1,200 ($200 interest + $1,000 principal)
        asset.mint(store, 1_200 * 1e6);

        vm.startPrank(store);
        asset.approve(address(pool), 1_200 * 1e6);
        loanCore.repay(vaultId, 1_200 * 1e6, address(pool));
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.accumulatedInterest, 0);
        assertEq(vault.principalDebt, 3_000 * 1e6);
    }

    function test_Repay_FullLoanSettlementAndCollateralRelease() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

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

        vm.warp(block.timestamp + 365 days); // $200 interest accrued

        // Repay $5,000 (total debt = $4,200, overpayment capped at $4,200)
        asset.mint(store, 5_000 * 1e6);

        vm.startPrank(store);
        asset.approve(address(pool), 5_000 * 1e6);
        loanCore.repay(vaultId, 5_000 * 1e6, address(pool));
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
        uint256 vaultId = loanCore.createVault();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroRepayAmount.selector));
        loanCore.repay(vaultId, 0, address(pool));
    }

    function test_RevertIf_Repay_NoActiveDebt() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(store);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.NoActiveDebt.selector, vaultId));
        loanCore.repay(vaultId, 1_000 * 1e6, address(pool));
    }

    function test_WithdrawCollateral_PartialExcessCollateral() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $3,000 (total FMV = $10,000, max borrow = $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 3_000 * 1e6, address(pool));

        // Withdraw cardId2 ($4,000 FMV). Remaining FMV = $6,000 (max borrow = $3,000). Debt = $3,000 -> succeeds
        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId2;

        vm.prank(store);
        loanCore.withdrawCollateral(vaultId, withdrawTokens);

        assertEq(vaultCard.ownerOf(cardId2), store);
    }

    function test_RevertIf_WithdrawCollateral_InsufficientCollateralRatio() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        // Borrow $4,000 (total FMV = $10,000, max borrow = $5,000)
        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

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
        uint256 vaultId = loanCore.createVault();

        vm.prank(store);
        vaultCard.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(store);
        loanCore.depositCollateral(vaultId, tokenIds);

        vm.startPrank(oracle);
        loanCore.setCardFmv(cardId1, 6_000 * 1e6);
        loanCore.setCardFmv(cardId2, 4_000 * 1e6);
        vm.stopPrank();

        MockERC20 asset = new MockERC20("Euro Coin", "EURC", 6);
        vm.prank(admin);
        HoloFiLendingPool pool = HoloFiLendingPool(poolFactory.createPool(IERC20(address(asset)), "Pool EURC", "pEURC"));

        vm.prank(admin);
        pool.setLoanCore(address(loanCore));
        asset.mint(address(pool), 100_000 * 1e6);

        vm.prank(store);
        loanCore.borrow(vaultId, 4_000 * 1e6, address(pool));

        asset.mint(store, 2_000 * 1e6);

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.startPrank(store);
        asset.approve(address(pool), 2_000 * 1e6);
        loanCore.repayAndWithdraw(vaultId, 2_000 * 1e6, address(pool), withdrawTokens);
        vm.stopPrank();

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.principalDebt, 2_000 * 1e6);
        assertEq(vaultCard.ownerOf(cardId1), store);
    }

    function test_RevertIf_RepayAndWithdraw_Unauthorized() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

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
        loanCore.repayAndWithdraw(vaultId, 0, address(0), withdrawTokens);
    }
}
