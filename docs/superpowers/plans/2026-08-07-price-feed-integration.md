# Integrate `HoloFiCardPriceFeed` with `HoloFiVaultLoanCore` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `HoloFiCardPriceFeed` with `HoloFiVaultLoanCore` and `HoloFiVaultCard`. Add `cardTypeId` to card metadata, refactor `PriceFeed.getPrice`, remove `getLatestPriceData`, decouple `HoloFiVaultLoanCore` from manual card price storage, and update `getVaultFMV` to query `priceFeed.getPrice(cardTypeId)` directly.

**Architecture:** Update `HoloFiVaultCard.sol` with `CardMetadata.cardTypeId` and `ZeroCardTypeId` validation. Refactor `HoloFiCardPriceFeed.sol` to return `(uint256 price, uint128 lastUpdated)` from `getPrice` and remove `getLatestPriceData`. In `HoloFiVaultLoanCore.sol`, inject `priceFeed` immutable, remove legacy `cardFmv` mapping/functions, and resolve `getVaultFMV` via `vaultCard.getCard(tokenId).cardTypeId` $\rightarrow$ `priceFeed.getPrice`. Update all unit tests, integration tests, and documentation.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Update `HoloFiVaultCard.sol`, `HoloFiCardPriceFeed.sol`, and Unit Tests (`*.t.sol`)

**Files:**
- Modify: `contracts/HoloFiVaultCard.sol`
- Modify: `contracts/HoloFiCardPriceFeed.sol`
- Modify: `contracts/HoloFiVaultCard.t.sol`
- Modify: `contracts/HoloFiCardPriceFeed.t.sol`

**Interfaces:**
- Produces: `CardMetadata.cardTypeId`, `mintCard` with `cardTypeId`, refactored `PriceFeed.getPrice(cardTypeId)` returning `(uint256, uint128)`, and removal of `getLatestPriceData`.

- [ ] **Step 1: Update `contracts/HoloFiVaultCard.sol`**

Add `cardTypeId` to `CardMetadata`, `ZeroCardTypeId()` error, updated `CardMinted` event, and `mintCard` validation:

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
    if (to == address(0)) revert ZeroAddressRecipient();
    if (cardTypeId == bytes32(0)) revert ZeroCardTypeId();
    if (attestationHash == bytes32(0)) revert InvalidAttestationHash();

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

- [ ] **Step 2: Update `contracts/HoloFiCardPriceFeed.sol`**

Refactor `getPrice` and remove `getLatestPriceData`:

```solidity
function getPrice(bytes32 cardTypeId) external view returns (uint256 price, uint128 lastUpdated) {
    PriceData memory data = prices[cardTypeId];
    return (uint256(data.price), data.lastUpdated);
}
```

- [ ] **Step 3: Update `contracts/HoloFiVaultCard.t.sol` and `contracts/HoloFiCardPriceFeed.t.sol`**

Update unit tests for `mintCard(..., cardTypeId, ...)` and `priceFeed.getPrice(cardTypeId)`. Add `test_RevertIf_MintCard_ZeroCardTypeId`. Remove `getLatestPriceData` unit tests.

- [ ] **Step 4: Commit Task 1**

```bash
git add contracts/HoloFiVaultCard.sol contracts/HoloFiCardPriceFeed.sol contracts/HoloFiVaultCard.t.sol contracts/HoloFiCardPriceFeed.t.sol
git commit -m "feat(HF-19): update HoloFiVaultCard metadata and refactor HoloFiCardPriceFeed getPrice (relates to HF-19)"
```

---

### Task 2: Integrate `HoloFiCardPriceFeed` with `HoloFiVaultLoanCore.sol` & Update Solidity Tests

**Files:**
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`
- Modify: `contracts/HoloFiDutchAuction.t.sol`

**Interfaces:**
- Produces: `LoanCore` constructor with `priceFeed`, removal of legacy `cardFmv` mapping/functions, and `getVaultFMV` querying `priceFeed.getPrice`.

- [ ] **Step 1: Update `contracts/HoloFiVaultLoanCore.sol`**

Inject `priceFeed` immutable, remove legacy `cardFmv` mapping/events/functions (`setCardFmv`, `setBatchCardFmv`), and update `getVaultFMV`:

```solidity
HoloFiCardPriceFeed public immutable priceFeed;
error ZeroAddressPriceFeed();

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

- [ ] **Step 2: Update `contracts/HoloFiVaultLoanCore.t.sol` and `contracts/HoloFiDutchAuction.t.sol`**

Deploy `HoloFiCardPriceFeed`, pass to `LoanCore` constructor, update `mintCard` calls with `cardTypeId`, and replace `setCardFmv` calls with `priceFeed.setPrice`. Add `test_RevertIf_Constructor_ZeroAddressPriceFeed`.

- [ ] **Step 3: Run Solidity tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (113 total Solidity unit tests).

- [ ] **Step 4: Commit Task 2**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol contracts/HoloFiDutchAuction.t.sol
git commit -m "feat(HF-19): integrate HoloFiCardPriceFeed into HoloFiVaultLoanCore and remove legacy price oracle (relates to HF-19)"
```

---

### Task 3: Update TypeScript Integration Tests & Architecture Documentation

**Files:**
- Modify: `test/HoloFiVaultCard.ts`
- Modify: `test/HoloFiCardPriceFeed.ts`
- Modify: `test/HoloFiVaultLoanCore.ts`
- Modify: `test/HoloFiDutchAuction.ts`
- Modify: `docs/System Architecture Document.md`

**Interfaces:**
- Produces: Fully updated TypeScript test suite and system architecture document.

- [ ] **Step 1: Update TypeScript Test Suite (`test/*.ts`)**

- `test/HoloFiVaultCard.ts`: Update `mintCard` calls with `cardTypeId` parameter.
- `test/HoloFiCardPriceFeed.ts`: Update `getPrice` return assertion (`[price, lastUpdated]`). Remove `getLatestPriceData` assertions.
- `test/HoloFiVaultLoanCore.ts` & `test/HoloFiDutchAuction.ts`: Deploy `HoloFiCardPriceFeed`, pass to `LoanCore` constructor, update `mintCard` calls, and replace `setCardFmv` with `priceFeed.setPrice`.

- [ ] **Step 2: Update `docs/System Architecture Document.md`**

Update `HoloFiVaultLoanCore` constructor signature and `getVaultFMV` resolution description.

- [ ] **Step 3: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (152+ total tests).

- [ ] **Step 4: Commit Task 3 with Linear Magic Word**

```bash
git add test/ "docs/System Architecture Document.md"
git commit -m "test(HF-19): update TypeScript integration tests and architecture docs for HoloFiCardPriceFeed integration (Fixes HF-19)"
```
