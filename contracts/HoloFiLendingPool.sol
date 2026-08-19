// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC4626, ERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

interface IHoloFiVaultLoanCore {
    function dutchAuction() external view returns (address);
}

/**
 * @title HoloFiLendingPool
 * @notice Generic permissioned ERC-4626 liquidity pool issuing custom pToken share tokens against ERC-20 deposits.
 */
contract HoloFiLendingPool is ERC4626 {
    uint256 public constant BPS_DENOMINATOR = 10000;

    AccessControlManager public immutable acm;
    address public loanCore;

    uint256 public maxLtvBps;                // Max LTV (e.g. 5000 = 50.00%)
    uint256 public liquidationThresholdBps; // Liquidation Threshold (e.g. 7000 = 70.00%)
    uint256 public liquidationPenaltyBps;   // Liquidation Penalty (e.g. 1000 = 10.00%)
    uint256 public borrowRateBpsPerYear;      // Borrow Rate APY (e.g. 500 = 5.00%)

    event LoanCoreUpdated(address indexed newLoanCore);
    event LiquidityDrawn(address indexed borrower, uint256 amount);
    event LiquidityReturned(address indexed payer, uint256 amount);
    event RiskParametersUpdated(
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 liquidationPenaltyBps,
        uint256 borrowRateBpsPerYear
    );

    error ZeroAddressAsset();
    error ZeroAddressACM();
    error ZeroAddressLoanCore();
    error UnauthorizedLoanCore(address caller);
    error UnauthorizedAdmin(address caller);
    error InsufficientVaultLiquidity(uint256 available, uint256 required);
    error ShareTokenNonTransferable();
    error InvalidRiskParameters();

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address _acm,
        uint256 _maxLtvBps,
        uint256 _liquidationThresholdBps,
        uint256 _liquidationPenaltyBps,
        uint256 _borrowRateBpsPerYear
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        if (address(asset_) == address(0)) {
            revert ZeroAddressAsset();
        }
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        if (_maxLtvBps > _liquidationThresholdBps || _liquidationThresholdBps > BPS_DENOMINATOR) {
            revert InvalidRiskParameters();
        }
        acm = AccessControlManager(_acm);
        maxLtvBps = _maxLtvBps;
        liquidationThresholdBps = _liquidationThresholdBps;
        liquidationPenaltyBps = _liquidationPenaltyBps;
        borrowRateBpsPerYear = _borrowRateBpsPerYear;
    }

    function setRiskParameters(
        uint256 _maxLtvBps,
        uint256 _liquidationThresholdBps,
        uint256 _liquidationPenaltyBps,
        uint256 _borrowRateBpsPerYear
    ) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        if (_maxLtvBps > _liquidationThresholdBps || _liquidationThresholdBps > BPS_DENOMINATOR) {
            revert InvalidRiskParameters();
        }
        maxLtvBps = _maxLtvBps;
        liquidationThresholdBps = _liquidationThresholdBps;
        liquidationPenaltyBps = _liquidationPenaltyBps;
        borrowRateBpsPerYear = _borrowRateBpsPerYear;
        emit RiskParametersUpdated(_maxLtvBps, _liquidationThresholdBps, _liquidationPenaltyBps, _borrowRateBpsPerYear);
    }

    function setLoanCore(address _loanCore) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        if (_loanCore == address(0)) {
            revert ZeroAddressLoanCore();
        }

        loanCore = _loanCore;
        emit LoanCoreUpdated(_loanCore);
    }

    function drawLiquidity(address recipient, uint256 amount) external {
        if (msg.sender != loanCore && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (available < amount) {
            revert InsufficientVaultLiquidity(available, amount);
        }

        IERC20(asset()).transfer(recipient, amount);
        emit LiquidityDrawn(recipient, amount);
    }

    function returnLiquidity(address payer, uint256 amount) external {
        address auction = (loanCore != address(0) && loanCore.code.length > 0) ? IHoloFiVaultLoanCore(loanCore).dutchAuction() : address(0);
        if (msg.sender != loanCore && msg.sender != auction && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }

        IERC20(asset()).transferFrom(payer, address(this), amount);
        emit LiquidityReturned(payer, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            revert ShareTokenNonTransferable();
        }
        super._update(from, to, value);
    }
}
