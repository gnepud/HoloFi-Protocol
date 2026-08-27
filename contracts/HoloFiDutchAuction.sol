// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { DecimalMath } from "./libraries/DecimalMath.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

/// @title HoloFiDutchAuction
/// @author Peng Du
/// @notice Conducts Dutch auctions to liquidate defaulted collateral vaults.
/// @dev Auction price decreases linearly from start price to reserve price over the duration.
contract HoloFiDutchAuction is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Stores state parameters for a vault liquidation auction.
    struct Auction {
        uint256 vaultId;
        uint256 startFmv;
        uint256 startPrice;
        uint256 debtAmount;
        uint256 penaltyAmount;
        uint256 reservePrice;
        uint256 startTime;
        uint256 duration;
        address seller;
        bool isSettled;
    }

    /// @notice Basis points denominator representing 100%.
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Starting auction price multiplier in basis points (12000 = 120%).
    uint256 public constant START_PRICE_BPS = 12000; // 120.00%

    /// @notice Default duration for each Dutch auction.
    uint256 public constant DEFAULT_AUCTION_DURATION = 48 hours;

    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice The core loan manager and collateral escrow contract.
    HoloFiVaultLoanCore public immutable loanCore;

    /// @notice The lending pool factory registry.
    HoloFiLendingPoolFactory public immutable poolFactory;

    /// @notice Address authorized to execute protocol treasury buybacks.
    address public treasury;

    /// @notice Maps a vault identifier to its liquidation auction data.
    mapping(uint256 => Auction) public auctions;

    /// @notice Emitted when a liquidation auction starts.
    /// @param vaultId Unique identifier of the liquidating vault.
    /// @param startPrice Initial asking price at auction start.
    /// @param reservePrice Floor price covering debt and penalty.
    /// @param startTime Block timestamp when the auction started.
    /// @param duration Total auction duration in seconds.
    event AuctionStarted(
        uint256 indexed vaultId,
        uint256 startPrice,
        uint256 reservePrice,
        uint256 startTime,
        uint256 duration
    );

    /// @notice Emitted when an auction is settled by a liquidator.
    /// @param vaultId Unique identifier of the settled vault.
    /// @param liquidator Address of the buyer purchasing the vault.
    /// @param lendingPool Address of the repaid lending pool.
    /// @param finalPrice Purchase price paid by the liquidator.
    /// @param debtPaid Amount of loan debt repaid to the pool.
    /// @param penaltyPaid Liquidation penalty transferred to the pool.
    /// @param surplusToSeller Excess purchase funds refunded to vault owner.
    event AuctionSettled(
        uint256 indexed vaultId,
        address indexed liquidator,
        address indexed lendingPool,
        uint256 finalPrice,
        uint256 debtPaid,
        uint256 penaltyPaid,
        uint256 surplusToSeller
    );

    /// @notice Emitted when the protocol treasury address is updated.
    /// @param newTreasury The newly configured treasury address.
    event TreasuryUpdated(address indexed newTreasury);

    /// @notice Emitted when the treasury executes a buyback on an expired auction.
    /// @param vaultId Unique identifier of the bought back vault.
    /// @param treasury Address of the executing treasury.
    /// @param lendingPool Address of the repaid lending pool.
    /// @param debtPaid Amount of debt repaid to the pool.
    event TreasuryBuybackExecuted(
        uint256 indexed vaultId,
        address indexed treasury,
        address indexed lendingPool,
        uint256 debtPaid
    );

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when the loan core address is zero.
    error ZeroAddressLoanCore();

    /// @notice Reverts when the pool factory address is zero.
    error ZeroAddressPoolFactory();

    /// @notice Reverts when an active auction already exists for the vault.
    /// @param vaultId Unique identifier of the vault.
    error AuctionAlreadyStarted(uint256 vaultId);

    /// @notice Reverts when attempting to interact with an inactive or settled auction.
    /// @param vaultId Unique identifier of the vault.
    error AuctionNotActive(uint256 vaultId);

    /// @notice Reverts when a lending pool is not registered in the factory.
    /// @param pool Address of the unrecognized lending pool.
    error UnregisteredLendingPool(address pool);

    /// @notice Reverts when the current auction price is below the reserve price.
    /// @param currentPrice The current calculated price.
    /// @param reservePrice The minimum allowed reserve price.
    error InsufficientAuctionPrice(uint256 currentPrice, uint256 reservePrice);

    /// @notice Reverts when caller lacks the admin role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedAdmin(address caller);

    /// @notice Reverts when caller lacks the pauser role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedPauser(address caller);

    /// @notice Reverts when setting treasury to the zero address.
    error ZeroAddressTreasury();

    /// @notice Reverts when caller is not the registered treasury.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedTreasury(address caller);

    /// @notice Reverts when a treasury buyback is attempted before auction expiry.
    /// @param vaultId Unique identifier of the vault.
    /// @param currentTime Current block timestamp.
    /// @param expiryTime Block timestamp when the auction expires.
    error AuctionNotExpired(uint256 vaultId, uint256 currentTime, uint256 expiryTime);

    /// @notice Initializes the Dutch auction contract.
    /// @param _acm Address of the AccessControlManager contract.
    /// @param _loanCore Address of the HoloFiVaultLoanCore contract.
    /// @param _poolFactory Address of the HoloFiLendingPoolFactory contract.
    constructor(address _acm, address _loanCore, address _poolFactory) {
        if (_acm == address(0)) revert ZeroAddressACM();
        if (_loanCore == address(0)) revert ZeroAddressLoanCore();
        if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();

        acm = AccessControlManager(_acm);
        loanCore = HoloFiVaultLoanCore(_loanCore);
        poolFactory = HoloFiLendingPoolFactory(_poolFactory);
    }

    /// @notice Pauses auction operations.
    /// @dev Caller must have PAUSER_ROLE or ADMIN_ROLE.
    function pause() external {
        if (!acm.hasRole(acm.PAUSER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedPauser(msg.sender);
        }
        _pause();
    }

    /// @notice Resumes auction operations.
    /// @dev Caller must have ADMIN_ROLE.
    function unpause() external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        _unpause();
    }

    /// @notice Starts a Dutch auction for a liquidatable vault.
    /// @dev Sets start price to 120% of normalized FMV or reserve price, whichever is higher.
    /// @param vaultId Unique identifier of the vault to liquidate.
    function startAuction(uint256 vaultId) external whenNotPaused {
        Auction storage auction = auctions[vaultId];
        if (auction.startTime != 0 && !auction.isSettled) {
            revert AuctionAlreadyStarted(vaultId);
        }

        loanCore.startLiquidation(vaultId);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        address lendingPool = vault.lendingPool;
        address poolAsset = HoloFiLendingPool(lendingPool).asset();
        uint256 startFmv18 = loanCore.getVaultFMV(vaultId);
        uint256 startFmv = DecimalMath.normalizeToAsset(startFmv18, poolAsset);
        uint256 totalDebt = loanCore.getTotalDebt(vaultId);
        uint256 penaltyBps = HoloFiLendingPool(lendingPool).liquidationPenaltyBps();

        uint256 penaltyAmount = (totalDebt * penaltyBps) / BPS_DENOMINATOR;
        uint256 reservePrice = totalDebt + penaltyAmount;

        uint256 startPrice = (startFmv * START_PRICE_BPS) / BPS_DENOMINATOR;
        if (startPrice < reservePrice) {
            startPrice = reservePrice;
        }

        auctions[vaultId] = Auction({
            vaultId: vaultId,
            startFmv: startFmv,
            startPrice: startPrice,
            debtAmount: totalDebt,
            penaltyAmount: penaltyAmount,
            reservePrice: reservePrice,
            startTime: block.timestamp,
            duration: DEFAULT_AUCTION_DURATION,
            seller: vault.owner,
            isSettled: false
        });

        emit AuctionStarted(vaultId, startPrice, reservePrice, block.timestamp, DEFAULT_AUCTION_DURATION);
    }

    /// @notice Calculates the current purchase price for an active auction.
    /// @dev Price drops linearly over the auction duration until reaching the reserve price.
    /// @param vaultId Unique identifier of the vault in auction.
    /// @return The current auction price denominated in the pool asset.
    function getAuctionPrice(uint256 vaultId) public view virtual returns (uint256) {
        Auction memory auction = auctions[vaultId];
        if (auction.startTime == 0 || auction.isSettled) {
            return 0;
        }

        uint256 elapsed = block.timestamp - auction.startTime;
        if (elapsed >= auction.duration) {
            return auction.reservePrice;
        }

        uint256 priceDrop = ((auction.startPrice - auction.reservePrice) * elapsed) / auction.duration;
        return auction.startPrice - priceDrop;
    }

    /// @notice Settles an active auction by purchasing the collateral vault.
    /// @dev Transfers payment from caller, repays debt to pool, and sends surplus to seller.
    /// @param vaultId Unique identifier of the auction to settle.
    function settleAuction(uint256 vaultId) external nonReentrant whenNotPaused {
        Auction storage auction = auctions[vaultId];
        if (auction.startTime == 0 || auction.isSettled) {
            revert AuctionNotActive(vaultId);
        }

        uint256 currentPrice = getAuctionPrice(vaultId);
        uint256 debtPaid = auction.debtAmount;
        uint256 penaltyPaid = auction.penaltyAmount;
        uint256 reservePrice = auction.reservePrice;

        if (currentPrice < reservePrice) {
            revert InsufficientAuctionPrice(currentPrice, reservePrice);
        }

        uint256 surplus = currentPrice - reservePrice;

        auction.isSettled = true;

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        address lendingPool = vault.lendingPool;
        IERC20 asset = IERC20(HoloFiLendingPool(lendingPool).asset());

        // Step 1: Pull full currentPrice from liquidator to DutchAuction contract
        asset.safeTransferFrom(msg.sender, address(this), currentPrice);

        // Step 2: Approve & return loan debt (debtPaid) to LendingPool
        uint256 principalPaid = vault.principalDebt;
        asset.forceApprove(lendingPool, debtPaid);
        HoloFiLendingPool(lendingPool).returnLiquidity(address(this), principalPaid, debtPaid);

        // Step 3: Transfer penalty surcharge directly into LendingPool contract
        if (penaltyPaid > 0) {
            asset.safeTransfer(lendingPool, penaltyPaid);
        }

        // Step 4: Refund residual equity surplus to original store (Vault Owner)
        if (surplus > 0) {
            asset.safeTransfer(auction.seller, surplus);
        }

        // Step 5: Finalize liquidation status, unlock & transfer collateral NFTs to liquidator
        loanCore.finalizeLiquidation(vaultId, msg.sender);

        emit AuctionSettled(vaultId, msg.sender, lendingPool, currentPrice, debtPaid, penaltyPaid, surplus);
    }

    /// @notice Updates the protocol treasury address.
    /// @param _treasury New address of the treasury receiver.
    function setTreasury(address _treasury) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        if (_treasury == address(0)) {
            revert ZeroAddressTreasury();
        }
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Allows the protocol treasury to buy back an expired, unsold auction at reserve debt.
    /// @dev If the auction duration has passed without a buyer, treasury can repay the debt.
    /// @param vaultId Unique identifier of the expired auction.
    function treasuryBuyback(uint256 vaultId) external nonReentrant whenNotPaused {
        if (msg.sender != treasury) {
            revert UnauthorizedTreasury(msg.sender);
        }

        Auction storage auction = auctions[vaultId];
        if (auction.startTime == 0 || auction.isSettled) {
            revert AuctionNotActive(vaultId);
        }

        uint256 expiryTime = auction.startTime + auction.duration;
        if (block.timestamp < expiryTime) {
            revert AuctionNotExpired(vaultId, block.timestamp, expiryTime);
        }

        uint256 debtPaid = auction.debtAmount;

        auction.isSettled = true;

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        address lendingPool = vault.lendingPool;
        IERC20 asset = IERC20(HoloFiLendingPool(lendingPool).asset());

        // Step 1: Pull exact debtPaid from treasury to DutchAuction
        asset.safeTransferFrom(msg.sender, address(this), debtPaid);

        // Step 2: Approve & return debt to LendingPool
        uint256 principalPaid = vault.principalDebt;
        asset.forceApprove(lendingPool, debtPaid);
        HoloFiLendingPool(lendingPool).returnLiquidity(address(this), principalPaid, debtPaid);

        // Step 3: Finalize liquidation & transfer collateral NFTs to treasury
        loanCore.finalizeLiquidation(vaultId, msg.sender);

        emit TreasuryBuybackExecuted(vaultId, msg.sender, lendingPool, debtPaid);
    }

    /// @notice Retrieves auction data for a specified vault.
    /// @param vaultId Unique identifier of the vault.
    /// @return Auction struct containing auction state.
    function getAuction(uint256 vaultId) external view returns (Auction memory) {
        return auctions[vaultId];
    }
}

