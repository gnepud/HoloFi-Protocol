// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC721URIStorage, ERC721 } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

/// @title HoloFiVaultCard
/// @author Peng Du
/// @notice ERC-721 token representing physical trading cards deposited in custody vaults.
/// @dev Includes attestation tracking, locking mechanisms, and custody burn verification.
contract HoloFiVaultCard is ERC721URIStorage {
    /// @notice Stores metadata and physical custody attestation for an NFT card.
    struct CardMetadata {
        uint256 tokenId;
        bytes32 cardTypeId;
        bytes32 attestationHash;
        uint256 mintTimestamp;
        bool isLocked;
    }

    /// @notice Maps a token identifier to its card metadata.
    mapping(uint256 => CardMetadata) public cards;

    /// @notice Tracks used attestation hashes to prevent duplicate minting.
    mapping(bytes32 => bool) public isAttestationUsed;

    /// @notice Next token identifier to assign upon minting.
    uint256 public nextTokenId;

    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice Emitted when a new vault card NFT is minted.
    /// @param tokenId The unique identifier of the minted token.
    /// @param to The recipient address.
    /// @param cardTypeId Identifier of the physical card model and grade.
    /// @param tokenUri Metadata URI pointing to card media.
    event CardMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed cardTypeId, string tokenUri);

    /// @notice Emitted when a vault card NFT is burned.
    /// @param tokenId The unique identifier of the burned token.
    /// @param owner The address of the token owner.
    /// @param cardTypeId Identifier of the physical card model and grade.
    /// @param attestationHash Hash of the released physical custody attestation.
    event CardBurned(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 indexed cardTypeId,
        bytes32 attestationHash
    );

    /// @notice Emitted when the lock status of a card changes.
    /// @param tokenId The unique identifier of the card.
    /// @param isLocked The new lock status flag.
    event CardLockUpdated(uint256 indexed tokenId, bool isLocked);

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when the recipient address is zero.
    error ZeroAddressRecipient();

    /// @notice Reverts when the card type identifier is zero.
    error ZeroCardTypeId();

    /// @notice Reverts when the attestation hash is zero.
    error InvalidAttestationHash();

    /// @notice Reverts when the attestation hash was already used.
    /// @param attestationHash The duplicate attestation hash.
    error AttestationAlreadyUsed(bytes32 attestationHash);

    /// @notice Reverts when caller lacks the minter role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedMinter(address caller);

    /// @notice Reverts when caller lacks the locker role.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedLockOperator(address caller);

    /// @notice Reverts when caller lacks permission to burn the token.
    /// @param caller The address of the unauthorized caller.
    error UnauthorizedBurner(address caller);

    /// @notice Reverts when querying or operating on a nonexistent token.
    /// @param tokenId The requested token identifier.
    error TokenDoesNotExist(uint256 tokenId);

    /// @notice Reverts when attempting to transfer or burn a locked card.
    /// @param tokenId The locked token identifier.
    error CardIsLocked(uint256 tokenId);

    /// @notice Initializes the vault card ERC-721 token contract.
    /// @param name Token collection name.
    /// @param symbol Token collection symbol.
    /// @param _acm Address of the AccessControlManager contract.
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

    /// @dev Hook executed before token transfers. If the card is locked, transfers revert.
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (cards[tokenId].isLocked) {
                revert CardIsLocked(tokenId);
            }
        }
        return super._update(to, tokenId, auth);
    }

    /// @notice Mints a new vault card NFT to the specified recipient.
    /// @dev Reverts if the attestation hash was already used.
    /// @param to Address that will receive the minted NFT.
    /// @param cardTypeId Identifier of the physical card model and grade.
    /// @param attestationHash Hash of the physical custody audit attestation.
    /// @param tokenUri Metadata URI pointing to card media and details.
    /// @return tokenId The unique identifier of the minted token.
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

    /// @notice Sets the lock status of a card token.
    /// @dev If a card is locked, standard ERC-721 transfers are disabled.
    /// @param tokenId Identifier of the card to update.
    /// @param isLocked New lock status flag.
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

    /// @notice Burns a card NFT upon physical redemption or owner request.
    /// @dev Clears card metadata and releases the attestation hash record.
    /// @param tokenId Identifier of the card to burn.
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

    /// @notice Retrieves card metadata for a specified token identifier.
    /// @param tokenId Identifier of the card to query.
    /// @return CardMetadata record of the requested card.
    function getCard(uint256 tokenId) external view returns (CardMetadata memory) {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        return cards[tokenId];
    }

    /// @notice Verifies raw attestation data against the stored attestation hash.
    /// @param tokenId Identifier of the card to verify.
    /// @param rawData Raw attestation payload bytes.
    /// @return True if the keccak256 hash of rawData matches the stored attestation hash.
    function verifyAttestation(uint256 tokenId, bytes calldata rawData) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        return cards[tokenId].attestationHash == keccak256(rawData);
    }
}
