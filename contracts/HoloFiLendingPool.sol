// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC4626, ERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiLendingPool
 * @notice Generic permissioned ERC-4626 liquidity pool issuing custom pToken share tokens against ERC-20 deposits.
 */
contract HoloFiLendingPool is ERC4626 {
    AccessControlManager public immutable acm;
    address public loanCore;

    event LoanCoreUpdated(address indexed newLoanCore);
    event LiquidityDrawn(address indexed borrower, uint256 amount);
    event LiquidityReturned(address indexed payer, uint256 amount);

    error ZeroAddressAsset();
    error ZeroAddressACM();
    error ZeroAddressLoanCore();
    error UnauthorizedLoanCore(address caller);
    error UnauthorizedAdmin(address caller);
    error InsufficientVaultLiquidity(uint256 available, uint256 required);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address _acm
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        if (address(asset_) == address(0)) {
            revert ZeroAddressAsset();
        }
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
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
        if (msg.sender != loanCore && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }

        IERC20(asset()).transferFrom(payer, address(this), amount);
        emit LiquidityReturned(payer, amount);
    }
}
