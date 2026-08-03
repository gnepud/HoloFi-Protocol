// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

/**
 * @title HoloFiVaultLoanCore
 * @notice Core credit manager and collateral escrow contract for HoloFi protocol.
 */
contract HoloFiVaultLoanCore is IERC721Receiver {
    enum VaultStatus { Active, Liquidating, Closed, Liquidated }

    struct CollateralVault {
        uint256 vaultId;
        address owner;               // Store wallet address
        uint256[] tokenIds;          // List of deposited NFT token IDs
        uint256 principalDebt;       // Borrowed capital
        uint256 accumulatedInterest; // Unpaid accrued interest
        uint256 lastInterestUpdateTime;  // Timestamp of last interest calculation
        VaultStatus status;
    }

    AccessControlManager public immutable acm;
    HoloFiCardCollection public immutable nftCollection;
    HoloFiLendingPoolFactory public immutable poolFactory;

    mapping(uint256 => CollateralVault) public vaults;
    mapping(uint256 => uint256) public nftVaultId;
    mapping(uint256 => uint256) public cardFmv;
    uint256 public nextVaultId = 1;
    address public dutchAuction;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant HEALTH_FACTOR_PRECISION = 1e18;

    uint256 public maxLtvBps = 5000;                // Max LTV: 50.00%
    uint256 public liquidationThresholdBps = 7000; // Liquidation Threshold: 70.00%
    uint256 public liquidationPenaltyBps = 1000;   // Liquidation Penalty: 10.00%
    uint256 public borrowRateBpsPerYear = 500;      // Borrow Rate: 5.00% APY

    event VaultCreated(uint256 indexed vaultId, address indexed owner);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CardFmvUpdated(uint256 indexed tokenId, uint256 fmv);
    event BorrowExecuted(
        uint256 indexed vaultId,
        address indexed owner,
        address indexed lendingPool,
        uint256 amount,
        uint256 newPrincipalDebt
    );
    event RiskParametersUpdated(
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 liquidationPenaltyBps,
        uint256 borrowRateBpsPerYear
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
    error ZeroAddressNFT();
    error ZeroAddressPoolFactory();
    error UnregisteredLendingPool(address pool);
    error KybRequired(address caller);
    error UnauthorizedVaultOwner(uint256 vaultId, address caller);
    error VaultNotActive(uint256 vaultId);
    error VaultHasActiveDebt(uint256 vaultId, uint256 totalDebt);
    error EmptyTokenIdsList();
    error TokenAlreadyInVault(uint256 tokenId, uint256 existingVaultId);
    error TokenNotInVault(uint256 tokenId, uint256 vaultId);
    error InvalidRiskParameters();
    error UnauthorizedAdmin(address caller);
    error UnauthorizedOracle(address caller);
    error ZeroBorrowAmount();
    error ExceedsMaxBorrowCapacity(uint256 vaultId, uint256 requestedTotalDebt, uint256 maxBorrowCapacity);
    error ArrayLengthMismatch();
    error ZeroRepayAmount();
    error NoActiveDebt(uint256 vaultId);
    error InsufficientCollateralRatio(uint256 vaultId, uint256 totalDebt, uint256 remainingMaxBorrow);
    error UnauthorizedAuction(address caller);
    error VaultNotEligibleForLiquidation(uint256 vaultId, uint256 healthFactor);
    error VaultNotLiquidating(uint256 vaultId);

    constructor(address _acm, address _nftCollection, address _poolFactory) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        if (_nftCollection == address(0)) {
            revert ZeroAddressNFT();
        }
        if (_poolFactory == address(0)) {
            revert ZeroAddressPoolFactory();
        }
        acm = AccessControlManager(_acm);
        nftCollection = HoloFiCardCollection(_nftCollection);
        poolFactory = HoloFiLendingPoolFactory(_poolFactory);
    }

    function setDutchAuction(address _dutchAuction) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        dutchAuction = _dutchAuction;
        emit DutchAuctionUpdated(_dutchAuction);
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

    function accrueInterest(uint256 vaultId) public {
        CollateralVault storage vault = vaults[vaultId];
        uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
        if (dt == 0) return;

        if (vault.principalDebt > 0) {
            uint256 interestNew = (vault.principalDebt * borrowRateBpsPerYear * dt) /
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

        return (vault.principalDebt * borrowRateBpsPerYear * dt) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function getTotalDebt(uint256 vaultId) public view returns (uint256) {
        CollateralVault memory vault = vaults[vaultId];
        return vault.principalDebt + vault.accumulatedInterest + getPendingInterest(vaultId);
    }

    function calculateHealthFactor(uint256 vaultFmv, uint256 totalDebt) public view returns (uint256) {
        if (totalDebt == 0) {
            return type(uint256).max;
        }
        return (vaultFmv * liquidationThresholdBps * HEALTH_FACTOR_PRECISION) / (totalDebt * BPS_DENOMINATOR);
    }

    function getHealthFactor(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
        return calculateHealthFactor(vaultFmv, getTotalDebt(vaultId));
    }

    function getMaxBorrowCapacity(uint256 vaultFmv) public view returns (uint256) {
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

    function createVault() external returns (uint256 vaultId) {
        if (!acm.isKybApproved(msg.sender)) {
            revert KybRequired(msg.sender);
        }

        vaultId = nextVaultId++;
        vaults[vaultId] = CollateralVault({
            vaultId: vaultId,
            owner: msg.sender,
            tokenIds: new uint256[](0),
            principalDebt: 0,
            accumulatedInterest: 0,
            lastInterestUpdateTime: block.timestamp,
            status: VaultStatus.Active
        });

        emit VaultCreated(vaultId, msg.sender);
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

            nftCollection.safeTransferFrom(msg.sender, address(this), tokenId);
            nftCollection.setCardLock(tokenId, true);

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
                withdrawnFmv += cardFmv[tokenId];
            }

            uint256 totalFmv = getVaultFMV(vaultId);
            uint256 remainingFmv = totalFmv > withdrawnFmv ? totalFmv - withdrawnFmv : 0;
            uint256 remainingMaxBorrow = getMaxBorrowCapacity(remainingFmv);

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
            nftCollection.setCardLock(tokenId, false);
            nftCollection.safeTransferFrom(address(this), vault.owner, tokenId);
        }

        emit CollateralWithdrawn(vaultId, vault.owner, tokenIds);
    }

    function repayAndWithdraw(
        uint256 vaultId,
        uint256 repayAmount,
        address lendingPool,
        uint256[] calldata withdrawTokenIds
    ) external {
        if (withdrawTokenIds.length > 0) {
            if (vaults[vaultId].owner != msg.sender) {
                revert UnauthorizedVaultOwner(vaultId, msg.sender);
            }
        }

        if (repayAmount > 0) {
            repay(vaultId, repayAmount, lendingPool);
        }

        if (withdrawTokenIds.length > 0) {
            withdrawCollateral(vaultId, withdrawTokenIds);
        }
    }

    function setCardFmv(uint256 tokenId, uint256 fmv) external {
        if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedOracle(msg.sender);
        }
        cardFmv[tokenId] = fmv;
        emit CardFmvUpdated(tokenId, fmv);
    }

    function setBatchCardFmv(uint256[] calldata tokenIds, uint256[] calldata fmvs) external {
        if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedOracle(msg.sender);
        }
        if (tokenIds.length != fmvs.length) {
            revert ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < tokenIds.length; i++) {
            cardFmv[tokenIds[i]] = fmvs[i];
            emit CardFmvUpdated(tokenIds[i], fmvs[i]);
        }
    }

    function getVaultFMV(uint256 vaultId) public view returns (uint256 totalFmv) {
        uint256[] memory tokenIds = vaults[vaultId].tokenIds;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            totalFmv += cardFmv[tokenIds[i]];
        }
    }

    function borrow(uint256 vaultId, uint256 amount, address lendingPool) external {
        if (!poolFactory.isValidPool(lendingPool)) {
            revert UnregisteredLendingPool(lendingPool);
        }
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
        uint256 maxBorrow = getMaxBorrowCapacity(vaultFmv);
        uint256 newTotalDebt = getTotalDebt(vaultId) + amount;

        if (newTotalDebt > maxBorrow) {
            revert ExceedsMaxBorrowCapacity(vaultId, newTotalDebt, maxBorrow);
        }

        vault.principalDebt += amount;

        HoloFiLendingPool(lendingPool).drawLiquidity(vault.owner, amount);

        emit BorrowExecuted(vaultId, vault.owner, lendingPool, amount, vault.principalDebt);
    }

    function repay(uint256 vaultId, uint256 amount, address lendingPool) public {
        if (!poolFactory.isValidPool(lendingPool)) {
            revert UnregisteredLendingPool(lendingPool);
        }
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

        HoloFiLendingPool(lendingPool).returnLiquidity(msg.sender, actualRepay);

        emit RepaymentExecuted(
            vaultId,
            msg.sender,
            lendingPool,
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
        uint256 totalDebt = getTotalDebt(vaultId);
        uint256 hf = calculateHealthFactor(fmv, totalDebt);

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
        vault.status = VaultStatus.Liquidated;

        uint256 len = vault.tokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = vault.tokenIds[i];
            nftVaultId[tokenId] = 0;
            nftCollection.setCardLock(tokenId, false);
            nftCollection.safeTransferFrom(address(this), liquidator, tokenId);
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
