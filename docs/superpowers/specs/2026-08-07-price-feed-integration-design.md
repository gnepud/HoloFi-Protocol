# Integrate `HoloFiCardPriceFeed` with `HoloFiVaultLoanCore` Specification

- **Feature**: HF-19 — Integrate `HoloFiCardPriceFeed` with `HoloFiVaultLoanCore`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-07
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This feature integrates `HoloFiCardPriceFeed` with `HoloFiVaultLoanCore` and `HoloFiVaultCard`. It adds `cardTypeId` to physical card NFT metadata, updates `mintCard` signature and validation, refactors `HoloFiCardPriceFeed.getPrice`, and decouples `HoloFiVaultLoanCore` from individual card price storage by querying `priceFeed.getPrice(cardTypeId)` directly during vault FMV resolution.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Smart Contracts**: `contracts/HoloFiVaultCard.sol`, `contracts/HoloFiCardPriceFeed.sol`, `contracts/HoloFiVaultLoanCore.sol`
* **Solidity Unit Tests**: `contracts/HoloFiVaultCard.t.sol`, `contracts/HoloFiCardPriceFeed.t.sol`, `contracts/HoloFiVaultLoanCore.t.sol`, `contracts/HoloFiDutchAuction.t.sol`
* **TypeScript Integration Tests**: `test/HoloFiVaultCard.ts`, `test/HoloFiCardPriceFeed.ts`, `test/HoloFiVaultLoanCore.ts`, `test/HoloFiDutchAuction.ts`
* **Documentation**: `docs/System Architecture Document.md`

---

### 2.2 Smart Contract Modifications

#### 1. `contracts/HoloFiVaultCard.sol`
```solidity
struct CardMetadata {
    uint256 tokenId;
    bytes32 cardTypeId;
    bytes32 attestationHash;
    uint256 mintTimestamp;
    bool isLocked;
}

event CardMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed cardTypeId, string tokenUri);
error ZeroCardTypeId();

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

    uint256 tokenId = nextTokenId++;

    cards[tokenId] = CardMetadata({
        tokenId: tokenId,
        cardTypeId: cardTypeId,
        attestationHash: attestationHash,
        mintTimestamp: block.timestamp,
        isLocked: false
    });

    _safeMint(to, tokenId);
    _setTokenURI(tokenId, tokenUri);

    emit CardMinted(tokenId, to, cardTypeId, tokenUri);
    return tokenId;
}
```

#### 2. `contracts/HoloFiCardPriceFeed.sol`
```solidity
function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated) {
    PriceData memory data = prices[cardTypeId];
    return (uint256(data.price), data.lastUpdated);
}

// Note: getLatestPriceData function removed as per spec.
```

#### 3. `contracts/HoloFiVaultLoanCore.sol`
```solidity
HoloFiCardPriceFeed public immutable priceFeed;

error ZeroAddressPriceFeed();

// Removed: cardFmv mapping, CardFmvUpdated event, setCardFmv, setBatchCardFmv, UnauthorizedOracle error, ArrayLengthMismatch error.

constructor(address _acm, address _vaultCard, address _poolFactory, address _priceFeed) {
    if (_acm == address(0)) revert ZeroAddressACM();
    if (_vaultCard == address(0)) revert ZeroAddressVaultCard();
    if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();
    if (_priceFeed == address(0)) revert ZeroAddressPriceFeed();

    acm = AccessControlManager(_acm);
    vaultCard = HoloFiVaultCard(_vaultCard);
    poolFactory = HoloFiLendingPoolFactory(_poolFactory);
    priceFeed = HoloFiCardPriceFeed(_priceFeed);
}

function getVaultFMV(uint256 vaultId) public view returns (uint256 totalFmv) {
    uint256[] memory tokenIds = vaults[vaultId].tokenIds;
    for (uint256 i = 0; i < tokenIds.length; i++) {
        uint256 tokenId = tokenIds[i];
        HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(tokenId);
        (uint256 price, ) = priceFeed.getPrice(card.cardTypeId);
        totalFmv += price;
    }
}
```

---

## 3. Test Suite Updates

1. **`HoloFiVaultCard` Tests**:
   - Update `mintCard` calls to include `cardTypeId`.
   - Test `ZeroCardTypeId` revert.
2. **`HoloFiCardPriceFeed` Tests**:
   - Update `getPrice` assertions to expect `(uint256 price, uint128 lastUpdated)`.
   - Remove `getLatestPriceData` test cases.
3. **`HoloFiVaultLoanCore` & `HoloFiDutchAuction` Tests**:
   - Deploy `HoloFiCardPriceFeed`.
   - Pass `priceFeed` address to `HoloFiVaultLoanCore` constructor.
   - Replace legacy `setCardFmv` / `setBatchCardFmv` calls with `priceFeed.setPrice` / `priceFeed.setBatchPrices`.
   - Test `ZeroAddressPriceFeed` constructor revert.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Complete test suite passing: `npx hardhat test` (All 152+ tests passing)
