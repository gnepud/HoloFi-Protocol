// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";

/**
 * @title HoloFiLendingPoolFactory
 * @notice Factory for deploying and registering permissioned HoloFiLendingPool instances.
 */
contract HoloFiLendingPoolFactory {
    AccessControlManager public immutable acm;
    mapping(address => address[]) public poolsByAsset;
    mapping(address => bool) public isValidPool;
    address[] public allPools;

    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);
    event PoolStatusUpdated(address indexed pool, bool isValid);

    error ZeroAddressACM();
    error ZeroAddressAsset();
    error ZeroAddressPool();
    error UnauthorizedOperator(address caller);

    constructor(address _acm) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

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

    function getPoolsByAsset(address asset) external view returns (address[] memory) {
        return poolsByAsset[asset];
    }

    function getPoolsByAssetLength(address asset) external view returns (uint256) {
        return poolsByAsset[asset].length;
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
