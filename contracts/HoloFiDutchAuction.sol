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

contract HoloFiDutchAuction is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

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

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant START_PRICE_BPS = 12000; // 120.00%
    uint256 public constant DEFAULT_AUCTION_DURATION = 48 hours;

    AccessControlManager public immutable acm;
    HoloFiVaultLoanCore public immutable loanCore;
    HoloFiLendingPoolFactory public immutable poolFactory;

    address public treasury;

    mapping(uint256 => Auction) public auctions;

    event AuctionStarted(
        uint256 indexed vaultId,
        uint256 startPrice,
        uint256 reservePrice,
        uint256 startTime,
        uint256 duration
    );

    event AuctionSettled(
        uint256 indexed vaultId,
        address indexed liquidator,
        address indexed lendingPool,
        uint256 finalPrice,
        uint256 debtPaid,
        uint256 penaltyPaid,
        uint256 surplusToSeller
    );

    event TreasuryUpdated(address indexed newTreasury);
    event TreasuryBuybackExecuted(
        uint256 indexed vaultId,
        address indexed treasury,
        address indexed lendingPool,
        uint256 debtPaid
    );

    error ZeroAddressACM();
    error ZeroAddressLoanCore();
    error ZeroAddressPoolFactory();
    error AuctionAlreadyStarted(uint256 vaultId);
    error AuctionNotActive(uint256 vaultId);
    error UnregisteredLendingPool(address pool);
    error InsufficientAuctionPrice(uint256 currentPrice, uint256 reservePrice);
    error UnauthorizedAdmin(address caller);
    error UnauthorizedPauser(address caller);
    error ZeroAddressTreasury();
    error UnauthorizedTreasury(address caller);
    error AuctionNotExpired(uint256 vaultId, uint256 currentTime, uint256 expiryTime);

    constructor(address _acm, address _loanCore, address _poolFactory) {
        if (_acm == address(0)) revert ZeroAddressACM();
        if (_loanCore == address(0)) revert ZeroAddressLoanCore();
        if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();

        acm = AccessControlManager(_acm);
        loanCore = HoloFiVaultLoanCore(_loanCore);
        poolFactory = HoloFiLendingPoolFactory(_poolFactory);
    }

    function pause() external {
        if (!acm.hasRole(acm.PAUSER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedPauser(msg.sender);
        }
        _pause();
    }

    function unpause() external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        _unpause();
    }

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
        asset.forceApprove(lendingPool, debtPaid);
        HoloFiLendingPool(lendingPool).returnLiquidity(address(this), debtPaid);

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
        asset.forceApprove(lendingPool, debtPaid);
        HoloFiLendingPool(lendingPool).returnLiquidity(address(this), debtPaid);

        // Step 3: Finalize liquidation & transfer collateral NFTs to treasury
        loanCore.finalizeLiquidation(vaultId, msg.sender);

        emit TreasuryBuybackExecuted(vaultId, msg.sender, lendingPool, debtPaid);
    }

    function getAuction(uint256 vaultId) external view returns (Auction memory) {
        return auctions[vaultId];
    }
}

