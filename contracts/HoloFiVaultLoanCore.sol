// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";

/**
 * @title HoloFiVaultLoanCore
 * @notice Core credit manager and collateral escrow contract for HoloFi protocol.
 */
contract HoloFiVaultLoanCore is IERC721Receiver {
    enum VaultStatus { Active, Liquidating, Closed }

    struct CollateralVault {
        uint256 vaultId;
        address owner;               // Boutique wallet address
        uint256[] tokenIds;          // List of deposited NFT token IDs
        uint256 principalDebt;       // Borrowed capital
        uint256 accumulatedInterest; // Unpaid accrued interest
        uint256 lastInterestUpdate;  // Timestamp of last interest calculation
        VaultStatus status;
    }

    AccessControlManager public immutable acm;
    HoloFiCardCollection public immutable nftCollection;

    mapping(uint256 => CollateralVault) public vaults;
    mapping(uint256 => uint256) public nftVaultId;
    uint256 public nextVaultId = 1;

    event VaultCreated(uint256 indexed vaultId, address indexed owner);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    error ZeroAddressACM();
    error ZeroAddressNFT();
    error KybRequired(address caller);
    error UnauthorizedVaultOwner(uint256 vaultId, address caller);
    error VaultNotActive(uint256 vaultId);
    error VaultHasActiveDebt(uint256 vaultId, uint256 totalDebt);
    error EmptyTokenIdsList();
    error TokenAlreadyInVault(uint256 tokenId, uint256 existingVaultId);
    error TokenNotInVault(uint256 tokenId, uint256 vaultId);

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
            lastInterestUpdate: block.timestamp,
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
