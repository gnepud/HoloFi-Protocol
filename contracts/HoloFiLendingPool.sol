// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC4626, ERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { ICardEligibilityPolicy } from "./interfaces/ICardEligibilityPolicy.sol";

/// @dev Minimal interface to query the Dutch auction contract from LoanCore.
interface IHoloFiVaultLoanCore {
    function dutchAuction() external view returns (address);
}

/// @title HoloFiLendingPool
/// @author Peng Du
/// @notice ERC-4626 liquidity pool supplying credit against vaulted card collateral.
/// @dev Issues non-transferable pToken shares to liquidity providers.
contract HoloFiLendingPool is ERC4626, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Basis points denominator representing 100%.
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice Address of the authorized HoloFiVaultLoanCore contract.
    address public loanCore;

    /// @notice Address of the optional card eligibility policy contract.
    address public eligibilityPolicy;

    /// @notice Maximum loan-to-value ratio allowed for borrowing, in basis points.
    uint256 public maxLtvBps;

    /// @notice Liquidation threshold ratio in basis points.
    uint256 public liquidationThresholdBps;

    /// @notice Liquidation penalty percentage charged to defaulting borrowers, in basis points.
    uint256 public liquidationPenaltyBps;

    /// @notice Annual borrow interest rate in basis points per year.
    uint256 public borrowRateBpsPerYear;

    /// @notice Total outstanding principal borrowed across all active vaults.
    uint256 public totalBorrows;

    /// @notice Emitted when the loan core contract address is updated.
    /// @param newLoanCore Address of the new loan core contract.
    event LoanCoreUpdated(address indexed newLoanCore);

    /// @notice Emitted when the card eligibility policy address is updated.
    /// @param newPolicy Address of the new card eligibility policy.
    event EligibilityPolicyUpdated(address indexed newPolicy);

    /// @notice Emitted when liquidity is disbursed for a borrow operation.
    /// @param borrower Address receiving the borrowed tokens.
    /// @param amount Amount of underlying assets disbursed.
    event LiquidityDrawn(address indexed borrower, uint256 amount);

    /// @notice Emitted when liquidity is returned to the pool from a loan repayment.
    /// @param payer Address providing the repayment tokens.
    /// @param principalAmount Amount of principal debt repaid.
    /// @param totalAmount Total payment amount including interest and fees.
    event LiquidityReturned(address indexed payer, uint256 principalAmount, uint256 totalAmount);

    /// @notice Emitted when pool risk and interest rate parameters are updated.
    /// @param maxLtvBps New maximum loan-to-value ratio in basis points.
    /// @param liquidationThresholdBps New liquidation threshold in basis points.
    /// @param liquidationPenaltyBps New liquidation penalty in basis points.
    /// @param borrowRateBpsPerYear New annual borrow interest rate in basis points.
    event RiskParametersUpdated(
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 liquidationPenaltyBps,
        uint256 borrowRateBpsPerYear
    );

    /// @notice Reverts when a mint or redeem operation specifies zero shares.
    error ZeroShares();

    /// @notice Reverts when a deposit or withdraw operation specifies zero assets.
    error ZeroAssets();

    /// @notice Reverts when the underlying asset address is zero.
    error ZeroAddressAsset();

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when setting the loan core address to zero.
    error ZeroAddressLoanCore();

    /// @notice Reverts when caller is not the authorized loan core contract or admin.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedLoanCore(address caller);

    /// @notice Reverts when caller lacks the admin role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedAdmin(address caller);

    /// @notice Reverts when caller lacks the pauser role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedPauser(address caller);

    /// @notice Reverts when pool cash reserves cannot cover the draw amount.
    /// @param available Current token balance in the pool.
    /// @param required Requested liquidity amount.
    error InsufficientVaultLiquidity(uint256 available, uint256 required);

    /// @notice Reverts when attempting peer-to-peer transfers of pToken shares.
    error ShareTokenNonTransferable();

    /// @notice Reverts when configured risk parameters violate safety invariants.
    error InvalidRiskParameters();

    /// @notice Reverts when principal repayment amount exceeds total repayment amount.
    /// @param principalAmount Principal portion to repay.
    /// @param totalAmount Total amount offered for repayment.
    error InvalidRepaymentAmounts(uint256 principalAmount, uint256 totalAmount);

    /// @notice Initializes the lending pool with underlying asset and risk parameters.
    /// @param asset_ The underlying ERC-20 token.
    /// @param name_ Name of the share token.
    /// @param symbol_ Symbol of the share token.
    /// @param _acm AccessControlManager address.
    /// @param _maxLtvBps Maximum loan-to-value ratio in basis points.
    /// @param _liquidationThresholdBps Liquidation threshold in basis points.
    /// @param _liquidationPenaltyBps Liquidation penalty in basis points.
    /// @param _borrowRateBpsPerYear Annual borrow interest rate in basis points.
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

    /// @notice Updates the risk and interest rate parameters for this pool.
    /// @param _maxLtvBps Maximum loan-to-value ratio in basis points.
    /// @param _liquidationThresholdBps Liquidation threshold ratio in basis points.
    /// @param _liquidationPenaltyBps Liquidation penalty in basis points.
    /// @param _borrowRateBpsPerYear Annual borrow rate in basis points.
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

    /// @notice Sets the loan core contract authorized to draw and return liquidity.
    /// @param _loanCore Address of the HoloFiVaultLoanCore contract.
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

    /// @notice Sets the card eligibility policy contract for collateral validation.
    /// @param _policy Address of the card eligibility policy.
    function setEligibilityPolicy(address _policy) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        eligibilityPolicy = _policy;
        emit EligibilityPolicyUpdated(_policy);
    }

    /// @notice Checks if a card type is accepted as collateral by this pool.
    /// @dev If no eligibility policy is set, all card types are allowed.
    /// @param cardTypeId Unique identifier of the card type.
    /// @return True if the card type is accepted as collateral.
    function isCollateralAllowed(bytes32 cardTypeId) public view returns (bool) {
        if (eligibilityPolicy == address(0)) {
            return true;
        }
        return ICardEligibilityPolicy(eligibilityPolicy).isCardTypeEligible(cardTypeId);
    }

    /// @notice Returns total assets managed by the pool, including cash reserves and active loans.
    /// @return Total pool assets in underlying token precision.
    function totalAssets() public view virtual override returns (uint256) {
        return super.totalAssets() + totalBorrows;
    }

    /// @notice Pauses pool deposits, mints, and borrows.
    /// @dev Caller must have PAUSER_ROLE or ADMIN_ROLE.
    function pause() external {
        if (!acm.hasRole(acm.PAUSER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedPauser(msg.sender);
        }
        _pause();
    }

    /// @notice Resumes pool operations.
    /// @dev Caller must have ADMIN_ROLE.
    function unpause() external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        _unpause();
    }

    function deposit(uint256 assets, address receiver) public virtual override whenNotPaused returns (uint256) {
        if (assets == 0) {
            revert ZeroAssets();
        }
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public virtual override whenNotPaused returns (uint256) {
        if (shares == 0) {
            revert ZeroShares();
        }
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public virtual override whenNotPaused returns (uint256) {
        if (assets == 0) {
            revert ZeroAssets();
        }
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public virtual override whenNotPaused returns (uint256) {
        if (shares == 0) {
            revert ZeroShares();
        }
        return super.redeem(shares, receiver, owner);
    }

    /// @notice Draws liquidity from pool reserves for loan disbursement.
    /// @dev Only the authorized loan core contract or admin can call this function.
    /// @param recipient Address receiving the borrowed assets.
    /// @param amount Amount of underlying assets to transfer.
    function drawLiquidity(address recipient, uint256 amount) external whenNotPaused {
        if (msg.sender != loanCore && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (available < amount) {
            revert InsufficientVaultLiquidity(available, amount);
        }

        totalBorrows += amount;
        IERC20(asset()).safeTransfer(recipient, amount);
        emit LiquidityDrawn(recipient, amount);
    }

    /// @notice Returns liquidity to the pool during loan repayment or liquidation.
    /// @dev Reduces totalBorrows by the principal amount and pulls total payment from payer.
    /// @param payer Address providing the repayment tokens.
    /// @param principalAmount Principal debt portion to reduce from active borrows.
    /// @param totalAmount Total payment amount including accrued interest and penalties.
    function returnLiquidity(address payer, uint256 principalAmount, uint256 totalAmount) external {
        if (principalAmount > totalAmount) {
            revert InvalidRepaymentAmounts(principalAmount, totalAmount);
        }
        address auction = (loanCore != address(0) && loanCore.code.length > 0) ? IHoloFiVaultLoanCore(loanCore).dutchAuction() : address(0);
        if (msg.sender != loanCore && msg.sender != auction && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }

        totalBorrows = (principalAmount >= totalBorrows) ? 0 : (totalBorrows - principalAmount);
        IERC20(asset()).safeTransferFrom(payer, address(this), totalAmount);
        emit LiquidityReturned(payer, principalAmount, totalAmount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            revert ShareTokenNonTransferable();
        }
        super._update(from, to, value);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        if (assets == 0) {
            revert ZeroAssets();
        }
        if (shares == 0) {
            revert ZeroShares();
        }
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (assets == 0) {
            revert ZeroAssets();
        }
        if (shares == 0) {
            revert ZeroShares();
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @dev Introduces a 3-decimal offset (10^3 virtual shares) to mitigate ERC-4626 inflation and donation attacks.
    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 3;
    }
}
