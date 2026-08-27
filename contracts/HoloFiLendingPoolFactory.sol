// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";

/// @title HoloFiLendingPoolFactory
/// @author Peng Du
/// @notice Deploys and tracks permissioned HoloFi lending pools.
/// @dev Stores registry mappings to verify official protocol lending pools.
contract HoloFiLendingPoolFactory {
    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice Maps an underlying asset address to its deployed lending pool addresses.
    mapping(address => address[]) public poolsByAsset;

    /// @notice Maps a pool address to its validity status.
    mapping(address => bool) public isValidPool;

    /// @notice List of all lending pools deployed by this factory.
    address[] public allPools;

    /// @notice Emitted when a new lending pool is created.
    /// @param underlyingAsset Address of the ERC-20 asset managed by the pool.
    /// @param poolAddress Address of the newly deployed lending pool.
    /// @param name Name of the pool LP share token.
    /// @param symbol Symbol of the pool LP share token.
    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);

    /// @notice Emitted when the validity status of a lending pool is updated.
    /// @param pool Address of the affected lending pool.
    /// @param isValid The new validity status.
    event PoolStatusUpdated(address indexed pool, bool isValid);

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when the underlying asset address is zero.
    error ZeroAddressAsset();

    /// @notice Reverts when a target pool address is zero.
    error ZeroAddressPool();

    /// @notice Reverts when caller lacks the admin role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedOperator(address caller);

    /// @notice Initializes the lending pool factory.
    /// @param _acm Address of the AccessControlManager contract.
    constructor(address _acm) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

    /// @notice Deploys a new lending pool for a specific underlying asset.
    /// @param asset ERC-20 underlying token for the lending pool.
    /// @param name Name for the pool LP share token.
    /// @param symbol Symbol for the pool LP share token.
    /// @param maxLtvBps Maximum loan-to-value ratio in basis points.
    /// @param liquidationThresholdBps Liquidation threshold ratio in basis points.
    /// @param liquidationPenaltyBps Liquidation penalty in basis points.
    /// @param borrowRateBpsPerYear Annual interest borrow rate in basis points.
    /// @return pool Address of the newly deployed lending pool.
    function createPool(
        IERC20 asset,
        string calldata name,
        string calldata symbol,
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 liquidationPenaltyBps,
        uint256 borrowRateBpsPerYear
    ) external returns (address pool) {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedOperator(msg.sender);
        }
        if (address(asset) == address(0)) {
            revert ZeroAddressAsset();
        }

        HoloFiLendingPool poolContract = new HoloFiLendingPool(
            asset,
            name,
            symbol,
            address(acm),
            maxLtvBps,
            liquidationThresholdBps,
            liquidationPenaltyBps,
            borrowRateBpsPerYear
        );
        pool = address(poolContract);

        poolsByAsset[address(asset)].push(pool);
        isValidPool[pool] = true;
        allPools.push(pool);

        emit PoolCreated(address(asset), pool, name, symbol);
    }

    /// @notice Updates the validity status of a lending pool.
    /// @param pool Address of the lending pool to update.
    /// @param isValid New validity status for the pool.
    function setPoolStatus(address pool, bool isValid) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedOperator(msg.sender);
        }
        if (pool == address(0)) {
            revert ZeroAddressPool();
        }
        isValidPool[pool] = isValid;
        emit PoolStatusUpdated(pool, isValid);
    }

    /// @notice Returns all pool addresses associated with an underlying asset.
    /// @param asset Address of the ERC-20 underlying token.
    /// @return Array of deployed pool addresses for the asset.
    function getPoolsByAsset(address asset) external view returns (address[] memory) {
        return poolsByAsset[asset];
    }

    /// @notice Returns the number of pools deployed for an underlying asset.
    /// @param asset Address of the ERC-20 underlying token.
    /// @return Total count of pools deployed for the asset.
    function getPoolsByAssetLength(address asset) external view returns (uint256) {
        return poolsByAsset[asset].length;
    }

    /// @notice Returns the total count of pools deployed by this factory.
    /// @return Total number of registered lending pools.
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
