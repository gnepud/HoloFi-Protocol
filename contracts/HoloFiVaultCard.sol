// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC721URIStorage, ERC721 } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiVaultCard
 * @notice Permissioned ERC-721 token contract representing physical card assets vaulted by Blink.
 */
contract HoloFiVaultCard is ERC721URIStorage {
    struct CardMetadata {
        uint256 tokenId;
        bytes32 cardTypeId;
        bytes32 attestationHash;
        uint256 mintTimestamp;
        bool isLocked;
    }

    mapping(uint256 => CardMetadata) public cards;
    mapping(bytes32 => bool) public isAttestationUsed;
    uint256 public nextTokenId;
    AccessControlManager public immutable acm;

    event CardMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed cardTypeId, string tokenUri);
    event CardBurned(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 indexed cardTypeId,
        bytes32 attestationHash
    );
    event CardLockUpdated(uint256 indexed tokenId, bool isLocked);

    error ZeroAddressACM();
    error ZeroAddressRecipient();
    error ZeroCardTypeId();
    error InvalidAttestationHash();
    error AttestationAlreadyUsed(bytes32 attestationHash);
    error UnauthorizedMinter(address caller);
    error UnauthorizedLockOperator(address caller);
    error UnauthorizedBurner(address caller);
    error TokenDoesNotExist(uint256 tokenId);
    error CardIsLocked(uint256 tokenId);

    constructor(
        string memory name,
        string memory symbol,
        address _acm
    ) ERC721(name, symbol) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
        nextTokenId = 1;
    }

    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (cards[tokenId].isLocked) {
                revert CardIsLocked(tokenId);
            }
        }
        return super._update(to, tokenId, auth);
    }

    function mintCard(
        address to,
        bytes32 cardTypeId,
        bytes32 attestationHash,
        string calldata tokenUri
    ) external returns (uint256) {
        if (!acm.hasRole(acm.MINTER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedMinter(msg.sender);
        }
        if (to == address(0)) {
            revert ZeroAddressRecipient();
        }
        if (cardTypeId == bytes32(0)) {
            revert ZeroCardTypeId();
        }
        if (attestationHash == bytes32(0)) {
            revert InvalidAttestationHash();
        }
        if (isAttestationUsed[attestationHash]) {
            revert AttestationAlreadyUsed(attestationHash);
        }

        uint256 tokenId = nextTokenId++;

        cards[tokenId] = CardMetadata({
            tokenId: tokenId,
            cardTypeId: cardTypeId,
            attestationHash: attestationHash,
            mintTimestamp: block.timestamp,
            isLocked: false
        });
        isAttestationUsed[attestationHash] = true;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);

        emit CardMinted(tokenId, to, cardTypeId, tokenUri);
        return tokenId;
    }

    function setCardLock(uint256 tokenId, bool isLocked) external {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        if (!acm.hasRole(acm.LOCKER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLockOperator(msg.sender);
        }

        cards[tokenId].isLocked = isLocked;
        emit CardLockUpdated(tokenId, isLocked);
    }

    function burnCard(uint256 tokenId) external {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        if (cards[tokenId].isLocked) {
            revert CardIsLocked(tokenId);
        }
        if (msg.sender != owner && !_isAuthorized(owner, msg.sender, tokenId)) {
            revert UnauthorizedBurner(msg.sender);
        }

        bytes32 cardTypeId = cards[tokenId].cardTypeId;
        bytes32 attestationHash = cards[tokenId].attestationHash;
        delete cards[tokenId];
        delete isAttestationUsed[attestationHash];

        _burn(tokenId);

        emit CardBurned(tokenId, owner, cardTypeId, attestationHash);
    }

    function getCard(uint256 tokenId) external view returns (CardMetadata memory) {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        return cards[tokenId];
    }

    function verifyAttestation(uint256 tokenId, bytes calldata rawData) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        return cards[tokenId].attestationHash == keccak256(rawData);
    }
}
