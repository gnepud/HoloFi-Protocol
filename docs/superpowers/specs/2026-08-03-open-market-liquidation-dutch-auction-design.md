# Open-Market Liquidation Engine (`HoloFiDutchAuction`) - Basic Setup Specification

- **Feature**: HF-25 — Open-Market Liquidation Engine Basic Setup (`HoloFiDutchAuction` & `HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-03
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This initial task for **HF-25** establishes the foundational contract structure, state variables, custom errors, events, and role-based access control hooks for the `HoloFiDutchAuction` liquidation architecture.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Contracts**: `contracts/HoloFiDutchAuction.sol` (New), `contracts/HoloFiVaultLoanCore.sol` (Extended)
* **Dependencies**: `contracts/AccessControlManager.sol`, `contracts/HoloFiCardCollection.sol`, `contracts/HoloFiLendingPoolFactory.sol`

### 2.2 `HoloFiDutchAuction.sol` Contract Shell

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

/**
 * @title HoloFiDutchAuction
 * @notice Open-market Dutch Auction liquidation engine for distressed store collateral vaults.
 */
contract HoloFiDutchAuction {
    struct Auction {
        uint256 vaultId;
        uint256 startFmv;
        uint256 startPrice;
        uint256 reservePrice;
        uint256 startTime;
        uint256 duration;
        address seller;
        bool isSettled;
    }

    uint256 public constant DEFAULT_AUCTION_DURATION = 48 hours;

    AccessControlManager public immutable acm;
    HoloFiVaultLoanCore public immutable loanCore;
    HoloFiLendingPoolFactory public immutable poolFactory;

    mapping(uint256 => Auction) public auctions; // vaultId => Auction

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
        uint256 surplusToSeller
    );

    error ZeroAddressACM();
    error ZeroAddressLoanCore();
    error ZeroAddressPoolFactory();
    error AuctionAlreadyStarted(uint256 vaultId);
    error AuctionNotActive(uint256 vaultId);
    error UnregisteredLendingPool(address pool);

    constructor(address _acm, address _loanCore, address _poolFactory) {
        if (_acm == address(0)) revert ZeroAddressACM();
        if (_loanCore == address(0)) revert ZeroAddressLoanCore();
        if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();

        acm = AccessControlManager(_acm);
        loanCore = HoloFiVaultLoanCore(_loanCore);
        poolFactory = HoloFiLendingPoolFactory(_poolFactory);
    }
}
```

### 2.3 `HoloFiVaultLoanCore.sol` Role Authorization Hooks

```solidity
address public dutchAuction;

error UnauthorizedAuction(address caller);
error VaultNotEligibleForLiquidation(uint256 vaultId, uint256 healthFactor);
error VaultNotLiquidating(uint256 vaultId);

event DutchAuctionUpdated(address indexed newAuction);
event VaultLiquidationStarted(uint256 indexed vaultId);
event VaultLiquidated(uint256 indexed vaultId, address indexed liquidator);

function setDutchAuction(address _dutchAuction) external {
    if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
        revert UnauthorizedAdmin(msg.sender);
    }
    dutchAuction = _dutchAuction;
    emit DutchAuctionUpdated(_dutchAuction);
}
```

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiDutchAuction.t.sol`)
1. `test_Constructor_InitialState`: Verify `acm`, `loanCore`, `poolFactory`, and `DEFAULT_AUCTION_DURATION` (48 hours).
2. `test_RevertIf_Constructor_ZeroAddresses`: Revert when zero addresses are passed to constructor.
3. `test_SetDutchAuction_Success`: Admin successfully sets `dutchAuction` address on `LoanCore`.
4. `test_RevertIf_SetDutchAuction_Unauthorized`: Non-admin attempt to set `dutchAuction` reverts with `UnauthorizedAdmin`.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
