// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";

/**
 * @title HoloFiVaultLoanCore
 * @notice Core credit manager and collateral escrow contract for HoloFi protocol.
 */
contract HoloFiVaultLoanCore is IERC721Receiver {
    enum VaultStatus { Active, Liquidating, Closed }

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

    mapping(uint256 => CollateralVault) public vaults;
    mapping(uint256 => uint256) public nftVaultId;
    mapping(uint256 => uint256) public cardFmv;
    uint256 public nextVaultId = 1;

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

    error ZeroAddressACM();
    error ZeroAddressNFT();
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

    constructor(address _acm, address _nftCollection) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        if (_nftCollection == address(0)) {
            revert ZeroAddressNFT();
        }
        acm = AccessControlManager(_acm);
        nftCollection = HoloFiCardCollection(_nftCollection);
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

    function withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) external {
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

        uint256 totalDebt = vault.principalDebt + vault.accumulatedInterest;
        if (totalDebt > 0) {
            revert VaultHasActiveDebt(vaultId, totalDebt);
        }

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (nftVaultId[tokenId] != vaultId) {
                revert TokenNotInVault(tokenId, vaultId);
            }

            nftCollection.setCardLock(tokenId, false);
            nftCollection.safeTransferFrom(address(this), msg.sender, tokenId);

            _removeTokenFromVault(vault, tokenId);
            delete nftVaultId[tokenId];
        }

        emit CollateralWithdrawn(vaultId, msg.sender, tokenIds);
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

    function repay(uint256 vaultId, uint256 amount, address lendingPool) external {
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
