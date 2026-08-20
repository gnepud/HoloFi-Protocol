// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { HoloFiVaultLoanCore } from "../HoloFiVaultLoanCore.sol";

/**
 * @title ReentrantAttacker
 * @notice Mock malicious contract to verify ReentrancyGuard protections in HoloFiVaultLoanCore.
 */
contract ReentrantAttacker is IERC721Receiver {
    enum AttackAction { None, ReenterWithdraw, ReenterBorrow, ReenterRepay }

    HoloFiVaultLoanCore public immutable loanCore;
    AttackAction public attackAction;
    uint256 public targetVaultId;
    uint256[] public attackTokenIds;
    uint256 public attackAmount;
    bool public attackAttempted;

    constructor(address _loanCore) {
        loanCore = HoloFiVaultLoanCore(_loanCore);
    }

    receive() external payable {}

    function createVault(address lendingPool) external returns (uint256) {
        return loanCore.createVault(lendingPool);
    }

    function depositCollateral(uint256 vaultId, uint256[] calldata tokenIds) external {
        loanCore.depositCollateral(vaultId, tokenIds);
    }

    function withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) external {
        loanCore.withdrawCollateral(vaultId, tokenIds);
    }

    function setAttackConfig(
        AttackAction _action,
        uint256 _vaultId,
        uint256[] calldata _tokenIds,
        uint256 _amount
    ) external {
        attackAction = _action;
        targetVaultId = _vaultId;
        attackTokenIds = _tokenIds;
        attackAmount = _amount;
        attackAttempted = false;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        if (attackAction == AttackAction.ReenterWithdraw && !attackAttempted) {
            attackAttempted = true;
            loanCore.withdrawCollateral(targetVaultId, attackTokenIds);
        } else if (attackAction == AttackAction.ReenterBorrow && !attackAttempted) {
            attackAttempted = true;
            loanCore.borrow(targetVaultId, attackAmount);
        } else if (attackAction == AttackAction.ReenterRepay && !attackAttempted) {
            attackAttempted = true;
            loanCore.repay(targetVaultId, attackAmount);
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
