// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";
import { HoloFiCardPriceFeed } from "./HoloFiCardPriceFeed.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

/**
 * @title HoloFiVaultLoanCore
 * @notice Core credit manager and collateral escrow contract for HoloFi protocol.
 */
contract HoloFiVaultLoanCore is IERC721Receiver {
    enum VaultStatus { Active, Liquidating, Closed }

    struct CollateralVault {
        uint256 vaultId;
        address owner;               // Store wallet address
        address lendingPool;         // Pool bound during creation
        uint256[] tokenIds;          // List of deposited NFT token IDs
        uint256 principalDebt;       // Borrowed capital
        uint256 accumulatedInterest; // Unpaid accrued interest
        uint256 lastInterestUpdateTime;  // Timestamp of last interest calculation
        VaultStatus status;
    }

    AccessControlManager public immutable acm;
    HoloFiVaultCard public immutable vaultCard;
    HoloFiLendingPoolFactory public immutable poolFactory;
    HoloFiCardPriceFeed public immutable priceFeed;

    mapping(uint256 => CollateralVault) public vaults;
    mapping(uint256 => uint256) public nftVaultId;
    uint256 public nextVaultId = 1;
    address public dutchAuction;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant HEALTH_FACTOR_PRECISION = 1e18;

    event VaultCreated(uint256 indexed vaultId, address indexed owner, address indexed lendingPool);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event BorrowExecuted(
        uint256 indexed vaultId,
        address indexed owner,
        address indexed lendingPool,
        uint256 amount,
        uint256 newPrincipalDebt
    );
    event InterestAccrued(
        uint256 indexed vaultId,
        uint256 interestAccrued,
        uint256 totalAccumulatedInterest,
        uint256 timestamp
    );
    event RepaymentExecuted(
        uint256 indexed vaultId,
        address indexed payer,
        address indexed lendingPool,
        uint256 totalRepaid,
        uint256 interestPaid,
        uint256 principalPaid,
        uint256 remainingPrincipalDebt,
        uint256 remainingAccumulatedInterest
    );
    event DutchAuctionUpdated(address indexed newAuction);
    event VaultLiquidationStarted(uint256 indexed vaultId);
    event VaultLiquidated(uint256 indexed vaultId, address indexed liquidator);

    error ZeroAddressACM();
    error ZeroAddressVaultCard();
    error ZeroAddressPoolFactory();
    error ZeroAddressPriceFeed();
    error UnregisteredLendingPool(address pool);
    error KybRequired(address caller);
    error UnauthorizedVaultOwner(uint256 vaultId, address caller);
    error VaultNotActive(uint256 vaultId);
    error VaultHasActiveDebt(uint256 vaultId, uint256 totalDebt);
    error EmptyTokenIdsList();
    error TokenAlreadyInVault(uint256 tokenId, uint256 existingVaultId);
    error TokenNotInVault(uint256 tokenId, uint256 vaultId);
    error UnauthorizedAdmin(address caller);
    error ZeroBorrowAmount();
    error ExceedsMaxBorrowCapacity(uint256 vaultId, uint256 requestedTotalDebt, uint256 maxBorrowCapacity);
    error ZeroRepayAmount();
    error NoActiveDebt(uint256 vaultId);
    error InsufficientCollateralRatio(uint256 vaultId, uint256 totalDebt, uint256 remainingMaxBorrow);
    error UnauthorizedAuction(address caller);
    error VaultNotEligibleForLiquidation(uint256 vaultId, uint256 healthFactor);
    error VaultNotLiquidating(uint256 vaultId);

    constructor(address _acm, address _vaultCard, address _poolFactory, address _priceFeed) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        if (_vaultCard == address(0)) {
            revert ZeroAddressVaultCard();
        }
        if (_poolFactory == address(0)) {
            revert ZeroAddressPoolFactory();
        }
        if (_priceFeed == address(0)) {
            revert ZeroAddressPriceFeed();
        }
        acm = AccessControlManager(_acm);
        vaultCard = HoloFiVaultCard(_vaultCard);
        poolFactory = HoloFiLendingPoolFactory(_poolFactory);
        priceFeed = HoloFiCardPriceFeed(_priceFeed);
    }

    function setDutchAuction(address _dutchAuction) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        dutchAuction = _dutchAuction;
        emit DutchAuctionUpdated(_dutchAuction);
    }

    function accrueInterest(uint256 vaultId) public {
        CollateralVault storage vault = vaults[vaultId];
        uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
        if (dt == 0) return;

        if (vault.principalDebt > 0) {
            uint256 borrowRate = HoloFiLendingPool(vault.lendingPool).borrowRateBpsPerYear();
            uint256 interestNew = (vault.principalDebt * borrowRate * dt) /
                (BPS_DENOMINATOR * SECONDS_PER_YEAR);
            vault.accumulatedInterest += interestNew;
            emit InterestAccrued(vaultId, interestNew, vault.accumulatedInterest, block.timestamp);
        }
        vault.lastInterestUpdateTime = block.timestamp;
    }

    function getPendingInterest(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
        if (dt == 0 || vault.principalDebt == 0) return 0;

        uint256 borrowRate = HoloFiLendingPool(vault.lendingPool).borrowRateBpsPerYear();
        return (vault.principalDebt * borrowRate * dt) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function getTotalDebt(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        return vault.principalDebt + vault.accumulatedInterest + getPendingInterest(vaultId);
    }

    function getHealthFactor(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
        uint256 totalDebt = getTotalDebt(vaultId);
        if (totalDebt == 0) {
            return type(uint256).max;
        }
        address pool = vaults[vaultId].lendingPool;
        uint256 ltBps = HoloFiLendingPool(pool).liquidationThresholdBps();
        return (vaultFmv * ltBps * HEALTH_FACTOR_PRECISION) / (totalDebt * BPS_DENOMINATOR);
    }

    function getMaxBorrowCapacity(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
        address pool = vaults[vaultId].lendingPool;
        uint256 maxLtvBps = HoloFiLendingPool(pool).maxLtvBps();
        return (vaultFmv * maxLtvBps) / BPS_DENOMINATOR;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function createVault(address lendingPool) external returns (uint256 vaultId) {
        if (!acm.isKybApproved(msg.sender)) {
            revert KybRequired(msg.sender);
        }
        if (!poolFactory.isValidPool(lendingPool)) {
            revert UnregisteredLendingPool(lendingPool);
        }

        vaultId = nextVaultId++;
        vaults[vaultId] = CollateralVault({
            vaultId: vaultId,
            owner: msg.sender,
            lendingPool: lendingPool,
            tokenIds: new uint256[](0),
            principalDebt: 0,
            accumulatedInterest: 0,
            lastInterestUpdateTime: block.timestamp,
            status: VaultStatus.Active
        });

        emit VaultCreated(vaultId, msg.sender, lendingPool);
    }

    function depositCollateral(uint256 vaultId, uint256[] calldata tokenIds) external {
        CollateralVault storage vault = vaults[vaultId];
        if (vault.owner != msg.sender) {
            revert UnauthorizedVaultOwner(vaultId, msg.sender);
        }
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }
        if (tokenIds.length == 0) {
            revert EmptyTokenIdsList();
        }

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 existingVault = nftVaultId[tokenId];
            if (existingVault != 0) {
                revert TokenAlreadyInVault(tokenId, existingVault);
            }

            vaultCard.safeTransferFrom(msg.sender, address(this), tokenId);
            vaultCard.setCardLock(tokenId, true);

            vault.tokenIds.push(tokenId);
            nftVaultId[tokenId] = vaultId;
        }

        emit CollateralDeposited(vaultId, msg.sender, tokenIds);
    }

    function withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) public {
        CollateralVault storage vault = vaults[vaultId];
        if (vault.owner != msg.sender) {
            revert UnauthorizedVaultOwner(vaultId, msg.sender);
        }
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }
        uint256 len = tokenIds.length;
        if (len == 0) {
            revert EmptyTokenIdsList();
        }

        accrueInterest(vaultId);

        uint256 currentTotalDebt = getTotalDebt(vaultId);

        if (currentTotalDebt > 0) {
            uint256 withdrawnFmv = 0;
            for (uint256 i = 0; i < len; i++) {
                uint256 tokenId = tokenIds[i];
                if (nftVaultId[tokenId] != vaultId) {
                    revert TokenNotInVault(tokenId, vaultId);
                }
                HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(tokenId);
                (uint256 price, ) = priceFeed.getPrice(card.cardTypeId);
                withdrawnFmv += price;
            }

            uint256 totalFmv = getVaultFMV(vaultId);
            uint256 remainingFmv = totalFmv > withdrawnFmv ? totalFmv - withdrawnFmv : 0;
            uint256 remainingMaxBorrow = getMaxBorrowCapacity(vaultId, remainingFmv);

            if (currentTotalDebt > remainingMaxBorrow) {
                revert InsufficientCollateralRatio(vaultId, currentTotalDebt, remainingMaxBorrow);
            }
        }

        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = tokenIds[i];
            if (currentTotalDebt == 0 && nftVaultId[tokenId] != vaultId) {
                revert TokenNotInVault(tokenId, vaultId);
            }

            _removeTokenFromVault(vault, tokenId);
            nftVaultId[tokenId] = 0;
            vaultCard.setCardLock(tokenId, false);
            vaultCard.safeTransferFrom(address(this), vault.owner, tokenId);
        }

        emit CollateralWithdrawn(vaultId, vault.owner, tokenIds);
    }

    function repayAndWithdraw(
        uint256 vaultId,
        uint256 repayAmount,
        uint256[] calldata withdrawTokenIds
    ) external {
        if (withdrawTokenIds.length > 0) {
            if (vaults[vaultId].owner != msg.sender) {
                revert UnauthorizedVaultOwner(vaultId, msg.sender);
            }
        }

        if (repayAmount > 0) {
            repay(vaultId, repayAmount);
        }

        if (withdrawTokenIds.length > 0) {
            withdrawCollateral(vaultId, withdrawTokenIds);
        }
    }

    function getVaultFMV(uint256 vaultId) public view returns (uint256 totalFmv) {
        uint256[] memory tokenIds = vaults[vaultId].tokenIds;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(tokenId);
            (uint256 price, ) = priceFeed.getPrice(card.cardTypeId);
            totalFmv += price;
        }
    }

    function borrow(uint256 vaultId, uint256 amount) external {
        CollateralVault storage vault = vaults[vaultId];
        if (msg.sender != vault.owner) {
            revert UnauthorizedVaultOwner(vaultId, msg.sender);
        }
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }
        if (amount == 0) {
            revert ZeroBorrowAmount();
        }

        accrueInterest(vaultId);

        uint256 vaultFmv = getVaultFMV(vaultId);
        uint256 maxBorrow = getMaxBorrowCapacity(vaultId, vaultFmv);
        uint256 newTotalDebt = getTotalDebt(vaultId) + amount;

        if (newTotalDebt > maxBorrow) {
            revert ExceedsMaxBorrowCapacity(vaultId, newTotalDebt, maxBorrow);
        }

        vault.principalDebt += amount;

        HoloFiLendingPool(vault.lendingPool).drawLiquidity(vault.owner, amount);

        emit BorrowExecuted(vaultId, vault.owner, vault.lendingPool, amount, vault.principalDebt);
    }

    function repay(uint256 vaultId, uint256 amount) public {
        CollateralVault storage vault = vaults[vaultId];
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }
        if (amount == 0) {
            revert ZeroRepayAmount();
        }

        accrueInterest(vaultId);

        uint256 totalDebt = vault.accumulatedInterest + vault.principalDebt;
        if (totalDebt == 0) {
            revert NoActiveDebt(vaultId);
        }

        uint256 actualRepay = amount > totalDebt ? totalDebt : amount;
        uint256 interestPaid;
        uint256 principalPaid;

        if (actualRepay <= vault.accumulatedInterest) {
            vault.accumulatedInterest -= actualRepay;
            interestPaid = actualRepay;
        } else {
            interestPaid = vault.accumulatedInterest;
            principalPaid = actualRepay - interestPaid;
            vault.accumulatedInterest = 0;
            vault.principalDebt -= principalPaid;
        }

        HoloFiLendingPool(vault.lendingPool).returnLiquidity(msg.sender, actualRepay);

        emit RepaymentExecuted(
            vaultId,
            msg.sender,
            vault.lendingPool,
            actualRepay,
            interestPaid,
            principalPaid,
            vault.principalDebt,
            vault.accumulatedInterest
        );
    }

    function startLiquidation(uint256 vaultId) external {
        if (msg.sender != dutchAuction) {
            revert UnauthorizedAuction(msg.sender);
        }
        CollateralVault storage vault = vaults[vaultId];
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }

        accrueInterest(vaultId);

        uint256 fmv = getVaultFMV(vaultId);
        uint256 hf = getHealthFactor(vaultId, fmv);

        if (hf >= HEALTH_FACTOR_PRECISION) {
            revert VaultNotEligibleForLiquidation(vaultId, hf);
        }

        vault.status = VaultStatus.Liquidating;
        emit VaultLiquidationStarted(vaultId);
    }

    function finalizeLiquidation(uint256 vaultId, address liquidator) external {
        if (msg.sender != dutchAuction) {
            revert UnauthorizedAuction(msg.sender);
        }
        CollateralVault storage vault = vaults[vaultId];
        if (vault.status != VaultStatus.Liquidating) {
            revert VaultNotLiquidating(vaultId);
        }

        vault.principalDebt = 0;
        vault.accumulatedInterest = 0;
        vault.status = VaultStatus.Closed;

        uint256 len = vault.tokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = vault.tokenIds[i];
            nftVaultId[tokenId] = 0;
            vaultCard.setCardLock(tokenId, false);
            vaultCard.safeTransferFrom(address(this), liquidator, tokenId);
        }

        delete vault.tokenIds;

        emit VaultLiquidated(vaultId, liquidator);
    }

    function getVault(uint256 vaultId) external view returns (CollateralVault memory) {
        return vaults[vaultId];
    }

    function getVaultTokenIds(uint256 vaultId) external view returns (uint256[] memory) {
        return vaults[vaultId].tokenIds;
    }

    function _removeTokenFromVault(CollateralVault storage vault, uint256 tokenId) internal {
        uint256 length = vault.tokenIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (vault.tokenIds[i] == tokenId) {
                vault.tokenIds[i] = vault.tokenIds[length - 1];
                vault.tokenIds.pop();
                break;
            }
        }
    }
}
