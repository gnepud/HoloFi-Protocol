// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { DecimalMath } from "./libraries/DecimalMath.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";
import { HoloFiCardPriceFeed } from "./HoloFiCardPriceFeed.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

/// @title HoloFiVaultLoanCore
/// @author Peng Du
/// @notice Manages collateral vaults, loan disbursement, interest accrual, and liquidations.
/// @dev Holds physical card NFTs in escrow and coordinates borrowing from lending pools.
contract HoloFiVaultLoanCore is IERC721Receiver, ReentrancyGuard, Pausable {
    /// @notice Lifecycle status of a collateral vault.
    enum VaultStatus { Active, Liquidating, Closed }

    /// @notice Stores collateral positions and outstanding debt for a vault.
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

    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice The ERC-721 vault card token contract.
    HoloFiVaultCard public immutable vaultCard;

    /// @notice The lending pool factory registry.
    HoloFiLendingPoolFactory public immutable poolFactory;

    /// @notice The oracle price feed for collateral valuations.
    HoloFiCardPriceFeed public immutable priceFeed;

    /// @notice Maps a vault identifier to its CollateralVault record.
    mapping(uint256 => CollateralVault) public vaults;

    /// @notice Maps a card token identifier to its assigned vault identifier.
    mapping(uint256 => uint256) public nftVaultId;

    /// @notice Next vault identifier to assign.
    uint256 public nextVaultId = 1;

    /// @notice Address of the authorized Dutch auction liquidation contract.
    address public dutchAuction;

    /// @notice Basis points denominator representing 100%.
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Standard number of seconds in a 365-day year for interest calculation.
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    /// @notice Fixed-point precision multiplier (1e18) for health factor calculations.
    uint256 public constant HEALTH_FACTOR_PRECISION = 1e18;

    /// @notice Emitted when a new collateral vault is created.
    /// @param vaultId Unique identifier of the created vault.
    /// @param owner Address of the vault owner.
    /// @param lendingPool Address of the bound lending pool.
    event VaultCreated(uint256 indexed vaultId, address indexed owner, address indexed lendingPool);

    /// @notice Emitted when card NFTs are deposited into a vault.
    /// @param vaultId Unique identifier of the vault.
    /// @param owner Address of the vault owner.
    /// @param tokenIds Array of deposited NFT token IDs.
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    /// @notice Emitted when card NFTs are withdrawn from a vault.
    /// @param vaultId Unique identifier of the vault.
    /// @param owner Address of the vault owner.
    /// @param tokenIds Array of withdrawn NFT token IDs.
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    /// @notice Emitted when a borrower draws funds against collateral.
    /// @param vaultId Unique identifier of the vault.
    /// @param owner Address of the borrowing owner.
    /// @param lendingPool Address of the lending pool providing funds.
    /// @param amount Amount of underlying assets borrowed.
    /// @param newPrincipalDebt Updated principal debt of the vault.
    event BorrowExecuted(
        uint256 indexed vaultId,
        address indexed owner,
        address indexed lendingPool,
        uint256 amount,
        uint256 newPrincipalDebt
    );

    /// @notice Emitted when unpaid interest is accrued on a vault.
    /// @param vaultId Unique identifier of the vault.
    /// @param interestAccrued Amount of newly accrued interest.
    /// @param totalAccumulatedInterest Updated total accumulated interest.
    /// @param timestamp Block timestamp of the accrual.
    event InterestAccrued(
        uint256 indexed vaultId,
        uint256 interestAccrued,
        uint256 totalAccumulatedInterest,
        uint256 timestamp
    );

    /// @notice Emitted when debt is repaid for a vault.
    /// @param vaultId Unique identifier of the vault.
    /// @param payer Address providing repayment funds.
    /// @param lendingPool Address of the repaid lending pool.
    /// @param totalRepaid Total amount paid.
    /// @param interestPaid Interest portion repaid.
    /// @param principalPaid Principal portion repaid.
    /// @param remainingPrincipalDebt Remaining principal debt.
    /// @param remainingAccumulatedInterest Remaining accumulated interest.
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

    /// @notice Emitted when the Dutch auction liquidator address is updated.
    /// @param newAuction Address of the new Dutch auction contract.
    event DutchAuctionUpdated(address indexed newAuction);

    /// @notice Emitted when liquidation starts for an undercollateralized vault.
    /// @param vaultId Unique identifier of the liquidating vault.
    event VaultLiquidationStarted(uint256 indexed vaultId);

    /// @notice Emitted when a liquidation is completed and collateral transferred.
    /// @param vaultId Unique identifier of the liquidated vault.
    /// @param liquidator Address of the buyer receiving collateral.
    event VaultLiquidated(uint256 indexed vaultId, address indexed liquidator);

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when the vault card contract address is zero.
    error ZeroAddressVaultCard();

    /// @notice Reverts when the pool factory contract address is zero.
    error ZeroAddressPoolFactory();

    /// @notice Reverts when the price feed contract address is zero.
    error ZeroAddressPriceFeed();

    /// @notice Reverts when a lending pool is not registered in the factory.
    /// @param pool Address of the unregistered pool.
    error UnregisteredLendingPool(address pool);

    /// @notice Reverts when caller lacks required KYB verification.
    /// @param caller Address of the unverified caller.
    error KybRequired(address caller);

    /// @notice Reverts when caller is not the owner of the vault.
    /// @param vaultId Unique identifier of the target vault.
    /// @param caller Address of the unauthorized caller.
    error UnauthorizedVaultOwner(uint256 vaultId, address caller);

    /// @notice Reverts when vault is not in active status.
    /// @param vaultId Unique identifier of the inactive vault.
    error VaultNotActive(uint256 vaultId);

    /// @notice Reverts when attempting an operation blocked by active debt.
    /// @param vaultId Unique identifier of the vault.
    /// @param totalDebt Outstanding total debt amount.
    error VaultHasActiveDebt(uint256 vaultId, uint256 totalDebt);

    /// @notice Reverts when an input array of token IDs is empty.
    error EmptyTokenIdsList();

    /// @notice Reverts when a card NFT is already deposited in another vault.
    /// @param tokenId The duplicate token identifier.
    /// @param existingVaultId Identifier of the vault currently holding the token.
    error TokenAlreadyInVault(uint256 tokenId, uint256 existingVaultId);

    /// @notice Reverts when a card NFT is not found in the specified vault.
    /// @param tokenId The missing token identifier.
    /// @param vaultId Target vault identifier.
    error TokenNotInVault(uint256 tokenId, uint256 vaultId);

    /// @notice Reverts when caller lacks the admin role.
    /// @param caller Address of the unauthorized caller.
    error UnauthorizedAdmin(address caller);

    /// @notice Reverts when caller lacks the pauser role.
    /// @param caller Address of the unauthorized caller.
    error UnauthorizedPauser(address caller);

    /// @notice Reverts when attempting to borrow zero tokens.
    error ZeroBorrowAmount();

    /// @notice Reverts when requested borrowing exceeds vault capacity.
    /// @param vaultId Unique identifier of the vault.
    /// @param requestedTotalDebt Resulting debt if borrow succeeds.
    /// @param maxBorrowCapacity Maximum borrowing capacity allowed.
    error ExceedsMaxBorrowCapacity(uint256 vaultId, uint256 requestedTotalDebt, uint256 maxBorrowCapacity);

    /// @notice Reverts when attempting to repay zero tokens.
    error ZeroRepayAmount();

    /// @notice Reverts when attempting repayment on a vault with zero debt.
    /// @param vaultId Unique identifier of the debt-free vault.
    error NoActiveDebt(uint256 vaultId);

    /// @notice Reverts when collateral withdrawal violates maximum borrowing limits.
    /// @param vaultId Unique identifier of the vault.
    /// @param totalDebt Active debt amount.
    /// @param remainingMaxBorrow Remaining borrowing capacity after withdrawal.
    error InsufficientCollateralRatio(uint256 vaultId, uint256 totalDebt, uint256 remainingMaxBorrow);

    /// @notice Reverts when caller is not the authorized Dutch auction contract.
    /// @param caller Address of the unauthorized caller.
    error UnauthorizedAuction(address caller);

    /// @notice Reverts when attempting liquidation on a vault with health factor >= 1.0.
    /// @param vaultId Unique identifier of the solvent vault.
    /// @param healthFactor Calculated health factor scaled by 1e18.
    error VaultNotEligibleForLiquidation(uint256 vaultId, uint256 healthFactor);

    /// @notice Reverts when finalizing liquidation on a vault not in liquidating status.
    /// @param vaultId Unique identifier of the vault.
    error VaultNotLiquidating(uint256 vaultId);

    /// @notice Reverts when card type is disallowed by the pool eligibility policy.
    /// @param tokenId Token identifier of the card.
    /// @param cardTypeId Card type key.
    /// @param lendingPool Address of the restrictive lending pool.
    error IneligibleCollateral(uint256 tokenId, bytes32 cardTypeId, address lendingPool);

    /// @notice Initializes the loan core contract with protocol dependencies.
    /// @param _acm Address of the AccessControlManager contract.
    /// @param _vaultCard Address of the HoloFiVaultCard contract.
    /// @param _poolFactory Address of the HoloFiLendingPoolFactory contract.
    /// @param _priceFeed Address of the HoloFiCardPriceFeed contract.
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

    /// @notice Pauses vault creations, collateral deposits, and borrows.
    /// @dev Caller must have PAUSER_ROLE or ADMIN_ROLE.
    function pause() external {
        if (!acm.hasRole(acm.PAUSER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedPauser(msg.sender);
        }
        _pause();
    }

    /// @notice Resumes loan core operations.
    /// @dev Caller must have ADMIN_ROLE.
    function unpause() external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        _unpause();
    }

    /// @notice Sets the Dutch auction contract authorized to liquidate defaulted vaults.
    /// @param _dutchAuction Address of the HoloFiDutchAuction contract.
    function setDutchAuction(address _dutchAuction) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        dutchAuction = _dutchAuction;
        emit DutchAuctionUpdated(_dutchAuction);
    }

    /// @notice Accrues unpaid borrow interest for a specific vault up to the current block timestamp.
    /// @dev Calculates simple annual interest based on the lending pool borrow rate.
    /// @param vaultId Unique identifier of the vault to update.
    function accrueInterest(uint256 vaultId) public {
        CollateralVault storage vault = vaults[vaultId];
        uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
        if (dt == 0) return;

        if (vault.principalDebt > 0) {
            uint256 borrowRate = HoloFiLendingPool(vault.lendingPool).borrowRateBpsPerYear();
            if (borrowRate > 0) {
                uint256 interestNew = (vault.principalDebt * borrowRate * dt) /
                    (BPS_DENOMINATOR * SECONDS_PER_YEAR);
                if (interestNew > 0) {
                    vault.accumulatedInterest += interestNew;
                    uint256 denominator = vault.principalDebt * borrowRate;
                    uint256 accountedDt = (interestNew * BPS_DENOMINATOR * SECONDS_PER_YEAR + denominator - 1) /
                        denominator;
                    vault.lastInterestUpdateTime += accountedDt;
                    emit InterestAccrued(vaultId, interestNew, vault.accumulatedInterest, block.timestamp);
                }
            } else {
                vault.lastInterestUpdateTime = block.timestamp;
            }
        } else {
            vault.lastInterestUpdateTime = block.timestamp;
        }
    }

    /// @notice Calculates pending unaccrued interest since the last update.
    /// @param vaultId Unique identifier of the vault.
    /// @return The pending interest amount in the pool asset precision.
    function getPendingInterest(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
        if (dt == 0 || vault.principalDebt == 0) return 0;

        uint256 borrowRate = HoloFiLendingPool(vault.lendingPool).borrowRateBpsPerYear();
        return (vault.principalDebt * borrowRate * dt) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    /// @notice Calculates total debt including principal, accumulated interest, and pending interest.
    /// @param vaultId Unique identifier of the vault.
    /// @return Total outstanding debt denominated in the pool asset.
    function getTotalDebt(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        return vault.principalDebt + vault.accumulatedInterest + getPendingInterest(vaultId);
    }

    /// @notice Computes the health factor of a vault based on total collateral value and debt.
    /// @dev If total debt is zero, returns type(uint256).max.
    /// @param vaultId Unique identifier of the vault.
    /// @param vaultFmv Fair market value of all collateral in 18-decimal USD.
    /// @return The calculated health factor scaled by 1e18.
    function getHealthFactor(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
        uint256 totalDebt = getTotalDebt(vaultId);
        if (totalDebt == 0) {
            return type(uint256).max;
        }
        address pool = vaults[vaultId].lendingPool;
        address asset = HoloFiLendingPool(pool).asset();
        uint256 normalizedFmv = DecimalMath.normalizeToAsset(vaultFmv, asset);
        uint256 ltBps = HoloFiLendingPool(pool).liquidationThresholdBps();
        return (normalizedFmv * ltBps * HEALTH_FACTOR_PRECISION) / (totalDebt * BPS_DENOMINATOR);
    }

    /// @notice Calculates maximum borrowing capacity based on collateral FMV and pool max LTV.
    /// @param vaultId Unique identifier of the vault.
    /// @param vaultFmv Total collateral fair market value in 18-decimal USD.
    /// @return Maximum borrow amount normalized to the pool asset precision.
    function getMaxBorrowCapacity(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
        address pool = vaults[vaultId].lendingPool;
        address asset = HoloFiLendingPool(pool).asset();
        uint256 maxLtvBps = HoloFiLendingPool(pool).maxLtvBps();
        uint256 maxBorrow18 = (vaultFmv * maxLtvBps) / BPS_DENOMINATOR;
        return DecimalMath.normalizeToAsset(maxBorrow18, asset);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Creates a new collateral vault bound to a verified lending pool.
    /// @dev The caller must have approved KYB status.
    /// @param lendingPool Address of the target lending pool.
    /// @return vaultId Unique identifier assigned to the new vault.
    function createVault(address lendingPool) external whenNotPaused returns (uint256 vaultId) {
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

    /// @notice Deposits card NFTs into an active vault as loan collateral.
    /// @dev Locks the deposited NFTs and verifies pool collateral eligibility.
    /// @param vaultId Unique identifier of the recipient vault.
    /// @param tokenIds Array of NFT card token identifiers to deposit.
    function depositCollateral(uint256 vaultId, uint256[] calldata tokenIds) external nonReentrant whenNotPaused {
        CollateralVault storage vault = vaults[vaultId];
        if (vault.owner != msg.sender) {
            revert UnauthorizedVaultOwner(vaultId, msg.sender);
        }
        if (!acm.isKybApproved(msg.sender)) {
            revert KybRequired(msg.sender);
        }
        if (vault.status != VaultStatus.Active) {
            revert VaultNotActive(vaultId);
        }
        if (tokenIds.length == 0) {
            revert EmptyTokenIdsList();
        }

        HoloFiLendingPool pool = HoloFiLendingPool(vault.lendingPool);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 existingVault = nftVaultId[tokenId];
            if (existingVault != 0) {
                revert TokenAlreadyInVault(tokenId, existingVault);
            }

            HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(tokenId);
            if (!pool.isCollateralAllowed(card.cardTypeId)) {
                revert IneligibleCollateral(tokenId, card.cardTypeId, vault.lendingPool);
            }

            vaultCard.safeTransferFrom(msg.sender, address(this), tokenId);
            vaultCard.setCardLock(tokenId, true);

            vault.tokenIds.push(tokenId);
            nftVaultId[tokenId] = vaultId;
        }

        emit CollateralDeposited(vaultId, msg.sender, tokenIds);
    }

    function _withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) internal whenNotPaused {
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

    /// @notice Withdraws collateral NFTs from an active vault.
    /// @dev If the vault has active debt, remaining collateral must satisfy the LTV requirement.
    /// @param vaultId Unique identifier of the vault.
    /// @param tokenIds Array of NFT card token identifiers to withdraw.
    function withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) external nonReentrant {
        _withdrawCollateral(vaultId, tokenIds);
    }

    function _repay(uint256 vaultId, uint256 amount) internal {
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

        HoloFiLendingPool(vault.lendingPool).returnLiquidity(msg.sender, principalPaid, actualRepay);

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

    /// @notice Repays outstanding debt for a vault.
    /// @dev Pays accumulated interest first, then reduces principal debt.
    /// @param vaultId Unique identifier of the vault.
    /// @param amount Maximum amount of tokens to repay.
    function repay(uint256 vaultId, uint256 amount) external nonReentrant {
        _repay(vaultId, amount);
    }

    /// @notice Repays debt and withdraws collateral in a single transaction.
    /// @param vaultId Unique identifier of the vault.
    /// @param repayAmount Amount of debt to repay.
    /// @param withdrawTokenIds Array of card token IDs to withdraw.
    function repayAndWithdraw(
        uint256 vaultId,
        uint256 repayAmount,
        uint256[] calldata withdrawTokenIds
    ) external nonReentrant {
        if (withdrawTokenIds.length > 0) {
            if (vaults[vaultId].owner != msg.sender) {
                revert UnauthorizedVaultOwner(vaultId, msg.sender);
            }
        }

        if (repayAmount > 0) {
            _repay(vaultId, repayAmount);
        }

        if (withdrawTokenIds.length > 0) {
            _withdrawCollateral(vaultId, withdrawTokenIds);
        }
    }

    /// @notice Calculates total 18-decimal USD fair market value of all cards in a vault.
    /// @param vaultId Unique identifier of the vault.
    /// @return totalFmv Sum of individual card prices from the price feed.
    function getVaultFMV(uint256 vaultId) public view returns (uint256 totalFmv) {
        uint256[] memory tokenIds = vaults[vaultId].tokenIds;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(tokenId);
            (uint256 price, ) = priceFeed.getPrice(card.cardTypeId);
            totalFmv += price;
        }
    }

    /// @notice Borrows underlying tokens from the lending pool against deposited collateral.
    /// @dev Total resulting debt must not exceed the vault maximum borrow capacity.
    /// @param vaultId Unique identifier of the borrowing vault.
    /// @param amount Amount of underlying tokens to borrow.
    function borrow(uint256 vaultId, uint256 amount) external nonReentrant whenNotPaused {
        CollateralVault storage vault = vaults[vaultId];
        if (msg.sender != vault.owner) {
            revert UnauthorizedVaultOwner(vaultId, msg.sender);
        }
        if (!acm.isKybApproved(msg.sender)) {
            revert KybRequired(msg.sender);
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

    /// @notice Initiates liquidation of an undercollateralized vault.
    /// @dev Only the authorized Dutch auction contract can call this function.
    /// @param vaultId Unique identifier of the vault to liquidate.
    function startLiquidation(uint256 vaultId) external nonReentrant whenNotPaused {
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

    /// @notice Finalizes liquidation, transfers collateral to liquidator, and closes the vault.
    /// @dev Only the authorized Dutch auction contract can call this function.
    /// @param vaultId Unique identifier of the liquidated vault.
    /// @param liquidator Address receiving the unlocked collateral NFTs.
    function finalizeLiquidation(uint256 vaultId, address liquidator) external nonReentrant whenNotPaused {
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

    /// @notice Retrieves the CollateralVault struct for a specified vault.
    /// @param vaultId Unique identifier of the vault.
    /// @return The CollateralVault record.
    function getVault(uint256 vaultId) external view returns (CollateralVault memory) {
        return vaults[vaultId];
    }

    /// @notice Returns all card token IDs currently deposited in a vault.
    /// @param vaultId Unique identifier of the vault.
    /// @return Array of NFT token IDs in the vault.
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
