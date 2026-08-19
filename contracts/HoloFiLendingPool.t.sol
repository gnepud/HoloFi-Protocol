// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { GradeEligibilityPolicy } from "./policies/GradeEligibilityPolicy.sol";
import { ICardEligibilityPolicy } from "./interfaces/ICardEligibilityPolicy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract HoloFiLendingPoolTest is Test {
    AccessControlManager public acm;
    MockERC20 public eurc;
    MockERC20 public weth;
    HoloFiLendingPool public poolEurc;
    HoloFiLendingPool public poolWeth;

    address public admin = address(0x1111);
    address public loanCore = address(0x2222);
    address public lp = address(0x3333);
    address public borrower = address(0x4444);
    address public unauthorized = address(0x5555);

    function setUp() public {
        acm = new AccessControlManager(admin);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);

        poolEurc = new HoloFiLendingPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC", address(acm), 5000, 7000, 1000, 500);
        poolWeth = new HoloFiLendingPool(IERC20(address(weth)), "HoloFi Pool WETH", "pWETH", address(acm), 6000, 8000, 1200, 600);

        eurc.mint(lp, 10_000 * 1e6);
        weth.mint(lp, 10 * 1e18);

        vm.startPrank(lp);
        eurc.approve(address(poolEurc), type(uint256).max);
        weth.approve(address(poolWeth), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(admin);
        poolEurc.setLoanCore(loanCore);
        poolWeth.setLoanCore(loanCore);
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(poolEurc.asset()), address(eurc));
        assertEq(address(poolEurc.acm()), address(acm));
        assertEq(poolEurc.name(), "HoloFi Pool EURC");
        assertEq(poolEurc.symbol(), "pEURC");
        assertEq(poolEurc.loanCore(), loanCore);
        assertEq(poolEurc.maxLtvBps(), 5000);
        assertEq(poolEurc.liquidationThresholdBps(), 7000);
        assertEq(poolEurc.liquidationPenaltyBps(), 1000);
        assertEq(poolEurc.borrowRateBpsPerYear(), 500);

        assertEq(address(poolWeth.asset()), address(weth));
        assertEq(poolWeth.name(), "HoloFi Pool WETH");
        assertEq(poolWeth.symbol(), "pWETH");
        assertEq(poolWeth.maxLtvBps(), 6000);
        assertEq(poolWeth.liquidationThresholdBps(), 8000);
        assertEq(poolWeth.liquidationPenaltyBps(), 1200);
        assertEq(poolWeth.borrowRateBpsPerYear(), 600);
    }

    function test_RevertIf_ZeroAddressAsset() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ZeroAddressAsset.selector));
        new HoloFiLendingPool(IERC20(address(0)), "Pool", "pTOKEN", address(acm), 5000, 7000, 1000, 500);
    }

    function test_RevertIf_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ZeroAddressACM.selector));
        new HoloFiLendingPool(IERC20(address(eurc)), "Pool", "pTOKEN", address(0), 5000, 7000, 1000, 500);
    }

    function test_RevertIf_Constructor_InvalidRiskParameters() public {
        // LTV > Liquidation threshold
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.InvalidRiskParameters.selector));
        new HoloFiLendingPool(IERC20(address(eurc)), "Pool", "pTOKEN", address(acm), 7500, 7000, 1000, 500);

        // Liquidation threshold > BPS_DENOMINATOR (10000)
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.InvalidRiskParameters.selector));
        new HoloFiLendingPool(IERC20(address(eurc)), "Pool", "pTOKEN", address(acm), 5000, 10001, 1000, 500);
    }

    function test_SetRiskParameters_Success() public {
        vm.prank(admin);
        poolEurc.setRiskParameters(4000, 6000, 800, 450);

        assertEq(poolEurc.maxLtvBps(), 4000);
        assertEq(poolEurc.liquidationThresholdBps(), 6000);
        assertEq(poolEurc.liquidationPenaltyBps(), 800);
        assertEq(poolEurc.borrowRateBpsPerYear(), 450);
    }

    function test_RevertIf_SetRiskParameters_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.UnauthorizedAdmin.selector, unauthorized));
        poolEurc.setRiskParameters(4000, 6000, 800, 450);
    }

    function test_RevertIf_SetRiskParameters_InvalidRiskParameters() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.InvalidRiskParameters.selector));
        poolEurc.setRiskParameters(7000, 6000, 800, 450);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.InvalidRiskParameters.selector));
        poolEurc.setRiskParameters(5000, 10500, 800, 450);
    }

    function test_DepositAndRedeem_6Decimals() public {
        vm.prank(lp);
        uint256 shares = poolEurc.deposit(1000 * 1e6, lp);
        assertEq(shares, 1000 * 1e6);
        assertEq(poolEurc.balanceOf(lp), 1000 * 1e6);

        // Inject 500 EURC interest into pool
        eurc.mint(address(poolEurc), 500 * 1e6);

        // Redeem shares
        vm.prank(lp);
        uint256 assetsReturned = poolEurc.redeem(shares, lp, lp);
        assertApproxEqAbs(assetsReturned, 1500 * 1e6, 1);
    }

    function test_DepositAndRedeem_18Decimals() public {
        vm.prank(lp);
        uint256 shares = poolWeth.deposit(1e18, lp);
        assertEq(shares, 1e18);

        // Inject 0.5 WETH interest into pool
        weth.mint(address(poolWeth), 5e17);

        vm.prank(lp);
        uint256 assetsReturned = poolWeth.redeem(shares, lp, lp);
        assertApproxEqAbs(assetsReturned, 1.5e18, 1);
    }

    function test_SetLoanCore_Success() public {
        address newLoanCore = address(0x9999);
        vm.prank(admin);
        poolEurc.setLoanCore(newLoanCore);
        assertEq(poolEurc.loanCore(), newLoanCore);
    }

    function test_RevertIf_ZeroAddressLoanCore() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ZeroAddressLoanCore.selector));
        poolEurc.setLoanCore(address(0));
    }

    function test_RevertIf_UnauthorizedSetLoanCore() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.UnauthorizedAdmin.selector, unauthorized));
        poolEurc.setLoanCore(address(0x8888));
    }

    function test_DrawLiquidity_Success() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(loanCore);
        poolEurc.drawLiquidity(borrower, 400 * 1e6);

        assertEq(eurc.balanceOf(borrower), 400 * 1e6);
        assertEq(eurc.balanceOf(address(poolEurc)), 600 * 1e6);
    }

    function test_RevertIf_UnauthorizedDrawLiquidity() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.UnauthorizedLoanCore.selector, unauthorized));
        poolEurc.drawLiquidity(borrower, 100 * 1e6);
    }

    function test_RevertIf_InsufficientVaultLiquidity() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(loanCore);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiLendingPool.InsufficientVaultLiquidity.selector,
                1000 * 1e6,
                2000 * 1e6
            )
        );
        poolEurc.drawLiquidity(borrower, 2000 * 1e6);
    }

    function test_ReturnLiquidity_Success() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(loanCore);
        poolEurc.drawLiquidity(borrower, 400 * 1e6);

        eurc.mint(borrower, 50 * 1e6); // Extra interest
        vm.prank(borrower);
        eurc.approve(address(poolEurc), 450 * 1e6);

        vm.prank(loanCore);
        poolEurc.returnLiquidity(borrower, 450 * 1e6);

        assertEq(eurc.balanceOf(address(poolEurc)), 1050 * 1e6);
    }

    function test_RevertIf_UnauthorizedReturnLiquidity() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.UnauthorizedLoanCore.selector, unauthorized));
        poolEurc.returnLiquidity(borrower, 100 * 1e6);
    }

    function test_RevertIf_TransferShareToken() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ShareTokenNonTransferable.selector));
        poolEurc.transfer(borrower, 100 * 1e6);
    }

    function test_RevertIf_TransferFromShareToken() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(lp);
        poolEurc.approve(unauthorized, 500 * 1e6);

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.ShareTokenNonTransferable.selector));
        poolEurc.transferFrom(lp, borrower, 100 * 1e6);
    }

    function test_SetEligibilityPolicy_Success() public {
        GradeEligibilityPolicy policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 0);

        vm.prank(admin);
        poolEurc.setEligibilityPolicy(address(policy));

        assertEq(poolEurc.eligibilityPolicy(), address(policy));
    }

    function test_RevertIf_SetEligibilityPolicy_Unauthorized() public {
        GradeEligibilityPolicy policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 0);

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPool.UnauthorizedAdmin.selector, unauthorized));
        poolEurc.setEligibilityPolicy(address(policy));
    }

    function test_IsCollateralAllowed_ZeroAddressPolicy() public view {
        assertEq(poolEurc.eligibilityPolicy(), address(0));
        bytes32 cardTypeId = keccak256("RandomCard");
        assertTrue(poolEurc.isCollateralAllowed(cardTypeId));
    }

    function test_IsCollateralAllowed_WithPolicy() public {
        GradeEligibilityPolicy policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 0);

        vm.prank(admin);
        poolEurc.setEligibilityPolicy(address(policy));

        ICardEligibilityPolicy.CardAttributes memory psa10 = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base",
            cardName: "Charizard",
            cardNumber: "4/102",
            printing: "1st",
            grader: "PSA",
            grade: "10"
        });

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

        bytes32 id10 = policy.computeCardTypeId(psa10);
        bytes32 id9 = policy.computeCardTypeId(psa9);

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), admin);
        policy.registerCardType(psa10);
        policy.registerCardType(psa9);
        vm.stopPrank();

        assertTrue(poolEurc.isCollateralAllowed(id10));
        assertFalse(poolEurc.isCollateralAllowed(id9));
    }
}
