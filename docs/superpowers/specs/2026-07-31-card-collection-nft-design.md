# HoloFiCardCollection NFT Contract Specification

- **Feature**: HF-12 — Develop NFT Contract (`HoloFiCardCollection`) Base ERC-721
- **Status**: Draft / Approved Design
- **Date**: 2026-07-31
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

The `HoloFiCardCollection` smart contract represents physical Trading Card Game (TCG) collectibles vaulted by physical logistics partner Blink as digital 1:1 twin NFTs.

It inherits OpenZeppelin's `ERC721URIStorage` for standard NFT metadata & token URI resolution, references `AccessControlManager` for permission management, and maintains physical attestation hashes and vault lock statuses for each minted card.

---

## 2. Technical Specification

### 2.1 File Location & Dependencies
* **File Location**: `contracts/HoloFiCardCollection.sol`
* **Base Contracts**: `@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol`
* **Dependencies**: `contracts/AccessControlManager.sol`

### 2.2 Role Definition in `AccessControlManager`
Add `MINTER_ROLE` to `AccessControlManager.sol`:
* `bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");`
* Configured in `AccessControlManager` constructor: `_setRoleAdmin(MINTER_ROLE, ADMIN_ROLE)`

### 2.3 On-Chain Data Model

```solidity
struct CardMetadata {
    uint256 tokenId;
    bytes32 attestationHash; // keccak256 hash of Blink physical metadata (Grader, Cert #, Grade)
    uint256 mintTimestamp;
    bool isLocked;           // True if committed inside a Collateral Vault
}

mapping(uint256 => CardMetadata) public cards;
uint256 public nextTokenId;
AccessControlManager public immutable acm;
```

### 2.4 Events & Custom Errors

#### Events
* `event CardMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed attestationHash, string tokenUri)`
* `event CardLockUpdated(uint256 indexed tokenId, bool isLocked)`

#### Custom Errors
* `ZeroAddressACM()`: Constructor called with `address(0)`.
* `ZeroAddressRecipient()`: `mintCard` called with `to == address(0)`.
* `InvalidAttestationHash()`: `mintCard` called with `attestationHash == bytes32(0)`.
* `UnauthorizedMinter(address caller)`: `mintCard` called by non-minter/non-admin.
* `UnauthorizedLockOperator(address caller)`: `setCardLock` called by unauthorized caller.
* `TokenDoesNotExist(uint256 tokenId)`: Query or action for non-existent token.

### 2.5 Contract Functions

#### `constructor(string memory name, string memory symbol, address _acm)`
- Reverts `ZeroAddressACM()` if `_acm == address(0)`.
- Sets `acm = AccessControlManager(_acm)`.
- Initializes `nextTokenId = 1`.

#### `mintCard(address to, bytes32 attestationHash, string calldata tokenUri) external returns (uint256)`
- Validation:
  - Reverts `UnauthorizedMinter(msg.sender)` if `!acm.hasRole(acm.MINTER_ROLE(), msg.sender)` and `!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)`.
  - Reverts `ZeroAddressRecipient()` if `to == address(0)`.
  - Reverts `InvalidAttestationHash()` if `attestationHash == bytes32(0)`.
- Logic:
  - Assigns `uint256 tokenId = nextTokenId++`.
  - Saves `cards[tokenId] = CardMetadata(tokenId, attestationHash, block.timestamp, false)`.
  - Calls `_safeMint(to, tokenId)`.
  - Calls `_setTokenURI(tokenId, tokenUri)`.
  - Emits `CardMinted(tokenId, to, attestationHash, tokenUri)`.
  - Returns `tokenId`.

#### `setCardLock(uint256 tokenId, bool isLocked) external`
- Validation:
  - Reverts `TokenDoesNotExist(tokenId)` if `_ownerOf(tokenId) == address(0)`.
  - Reverts `UnauthorizedLockOperator(msg.sender)` if `!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)`.
- Logic:
  - Updates `cards[tokenId].isLocked = isLocked`.
  - Emits `CardLockUpdated(tokenId, isLocked)`.

#### `getCard(uint256 tokenId) external view returns (CardMetadata memory)`
- Reverts `TokenDoesNotExist(tokenId)` if `_ownerOf(tokenId) == address(0)`.
- Returns `cards[tokenId]`.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiCardCollection.t.sol`)
1. `test_Constructor_InitialState`: Verify collection name, symbol, ACM reference, and nextTokenId initialization.
2. `test_RevertIf_ZeroAddressACM`: Verify constructor reverts with `ZeroAddressACM()`.
3. `test_MintCard_Success`: Verify minter can mint NFT with attestationHash and tokenURI, checking metadata, `ownerOf`, and `tokenURI`.
4. `test_RevertIf_UnauthorizedMinter`: Verify unauthorized caller cannot mint card.
5. `test_RevertIf_ZeroAddressRecipient`: Verify minting to `address(0)` reverts.
6. `test_RevertIf_InvalidAttestationHash`: Verify minting with `bytes32(0)` attestationHash reverts.
7. `test_SetCardLock_Success`: Verify admin can lock/unlock a card.
8. `test_RevertIf_NonExistentToken`: Verify queries on non-existent token revert.

### 3.2 TypeScript Integration Tests (`test/HoloFiCardCollection.ts`)
1. Deploy `AccessControlManager` and `HoloFiCardCollection` in Hardhat 3 fixture.
2. Grant `MINTER_ROLE` to minter account using `acm.grantRole`.
3. Mint card, verify `CardMinted` event emission and metadata properties.
4. Verify token URI resolution.

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
