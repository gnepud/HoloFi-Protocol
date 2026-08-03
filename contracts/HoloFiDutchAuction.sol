// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

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
