// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";

/**
 * @title HoloFiLendingPoolFactory
 * @notice Factory for deploying and registering permissioned HoloFiLendingPool instances per underlying asset.
 */
contract HoloFiLendingPoolFactory {
    AccessControlManager public immutable acm;
    mapping(address => address) public getPool;
    address[] public allPools;

    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);

    error ZeroAddressACM();
    error ZeroAddressAsset();
    error PoolAlreadyExists(address underlyingAsset, address existingPool);
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
        string calldata symbol
    ) external returns (address pool) {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender) && !acm.hasRole(acm.ORACLE_ROLE(), msg.sender)) {
            revert UnauthorizedOperator(msg.sender);
        }
        if (address(asset) == address(0)) {
            revert ZeroAddressAsset();
        }
        address existingPool = getPool[address(asset)];
        if (existingPool != address(0)) {
            revert PoolAlreadyExists(address(asset), existingPool);
        }

        HoloFiLendingPool poolContract = new HoloFiLendingPool(asset, name, symbol, address(acm));
        pool = address(poolContract);

        getPool[address(asset)] = pool;
        allPools.push(pool);

        emit PoolCreated(address(asset), pool, name, symbol);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
