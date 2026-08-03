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

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant START_PRICE_BPS = 12000; // 120.00%
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

    function startAuction(uint256 vaultId) external {
        Auction storage auction = auctions[vaultId];
        if (auction.startTime != 0 && !auction.isSettled) {
            revert AuctionAlreadyStarted(vaultId);
        }

        loanCore.startLiquidation(vaultId);

        uint256 startFmv = loanCore.getVaultFMV(vaultId);
        uint256 totalDebt = loanCore.getTotalDebt(vaultId);

        uint256 startPrice = (startFmv * START_PRICE_BPS) / BPS_DENOMINATOR;
        uint256 reservePrice = totalDebt;
        if (startPrice < reservePrice) {
            startPrice = reservePrice;
        }

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);

        auctions[vaultId] = Auction({
            vaultId: vaultId,
            startFmv: startFmv,
            startPrice: startPrice,
            reservePrice: reservePrice,
            startTime: block.timestamp,
            duration: DEFAULT_AUCTION_DURATION,
            seller: vault.owner,
            isSettled: false
        });

        emit AuctionStarted(vaultId, startPrice, reservePrice, block.timestamp, DEFAULT_AUCTION_DURATION);
    }

    function getAuctionPrice(uint256 vaultId) public view returns (uint256) {
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

    function getAuction(uint256 vaultId) external view returns (Auction memory) {
        return auctions[vaultId];
    }
}
