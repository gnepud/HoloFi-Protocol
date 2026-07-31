# HoloFiCardCollection NFT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and test `HoloFiCardCollection.sol` ERC-721 NFT contract with metadata, physical attestation verification, locking logic, and `AccessControlManager` integration.

**Architecture:** `HoloFiCardCollection.sol` inherits OpenZeppelin `ERC721URIStorage`, connects to `AccessControlManager` for role authorization (`MINTER_ROLE`, `ADMIN_ROLE`), stores `CardMetadata` per token, and provides `verifyAttestation(uint256 tokenId, bytes calldata rawData)`. Unit tested via `contracts/HoloFiCardCollection.t.sol` (Solidity + forge-std) and integration tested via `test/HoloFiCardCollection.ts` (Hardhat 3 + Ethers v6 + Mocha + Chai).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use `(Fixes HF-12)` for closing commits or `(relates to HF-12)` for non-closing commits
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Add `MINTER_ROLE` to `AccessControlManager.sol` & Update Existing Test Suites

**Files:**
- Modify: `contracts/AccessControlManager.sol`
- Modify: `contracts/AccessControlManager.t.sol`
- Modify: `test/AccessControlManager.ts`

**Interfaces:**
- Produces: `MINTER_ROLE` constant on `AccessControlManager` with `ADMIN_ROLE` configured as role admin.

- [ ] **Step 1: Add MINTER_ROLE tests to `contracts/AccessControlManager.t.sol` and `test/AccessControlManager.ts`**

Add to `contracts/AccessControlManager.t.sol`:
```solidity
    function test_MinterRoleHierarchy() public view {
        assertEq(acm.getRoleAdmin(acm.MINTER_ROLE()), acm.ADMIN_ROLE());
    }
```

Add to `test/AccessControlManager.ts`:
```ts
  it("Should configure MINTER_ROLE correctly under ADMIN_ROLE", async function () {
    const { acm, admin, user } = await networkHelpers.loadFixture(deployAcmFixture);
    const minterRole = await acm.MINTER_ROLE();
    await acm.connect(admin).grantRole(minterRole, user.address);
    expect(await acm.hasRole(minterRole, user.address)).to.be.true;
  });
```

- [ ] **Step 2: Run test suite to verify failure before implementation**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: FAIL due to missing `MINTER_ROLE` getter.

- [ ] **Step 3: Add `MINTER_ROLE` to `AccessControlManager.sol`**

In `contracts/AccessControlManager.sol`:
```solidity
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
```
And in constructor:
```solidity
        _setRoleAdmin(MINTER_ROLE, ADMIN_ROLE);
```

- [ ] **Step 4: Run build, typecheck, and test suite to verify pass**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly.

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/AccessControlManager.sol contracts/AccessControlManager.t.sol test/AccessControlManager.ts
git commit -m "feat(HF-12): add MINTER_ROLE to AccessControlManager (relates to HF-12)"
```

---

### Task 2: Implement `HoloFiCardCollection.sol` Contract & Solidity Unit Tests

**Files:**
- Create: `contracts/HoloFiCardCollection.sol`
- Create: `contracts/HoloFiCardCollection.t.sol`

**Interfaces:**
- Produces: `HoloFiCardCollection` contract with functions `mintCard`, `setCardLock`, `getCard`, `verifyAttestation`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiCardCollection.t.sol`)**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";

contract HoloFiCardCollectionTest is Test {
    AccessControlManager public acm;
    HoloFiCardCollection public cardCollection;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public user = address(0x3333);

    bytes32 public constant TEST_ATTESTATION = keccak256("Blink:PSA:10:123456");
    bytes public constant RAW_DATA = "Blink:PSA:10:123456";

    function setUp() public {
        acm = new AccessControlManager(admin);
        vm.prank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);

        cardCollection = new HoloFiCardCollection("HoloFi TCG Cards", "HFC", address(acm));
    }

    function test_Constructor_InitialState() public view {
        assertEq(cardCollection.name(), "HoloFi TCG Cards");
        assertEq(cardCollection.symbol(), "HFC");
        assertEq(address(cardCollection.acm()), address(acm));
        assertEq(cardCollection.nextTokenId(), 1);
    }

    function test_RevertIf_ZeroAddressACM() public {
        vm.expectRevert(HoloFiCardCollection.ZeroAddressACM.selector);
        new HoloFiCardCollection("HoloFi", "HFC", address(0));
    }

    function test_MintCard_Success() public {
        vm.prank(minter);
        uint256 tokenId = cardCollection.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        assertEq(tokenId, 1);
        assertEq(cardCollection.ownerOf(1), user);
        assertEq(cardCollection.tokenURI(1), "ipfs://QmTestHash");

        HoloFiCardCollection.CardMetadata memory card = cardCollection.getCard(1);
        assertEq(card.tokenId, 1);
        assertEq(card.attestationHash, TEST_ATTESTATION);
        assertEq(card.isLocked, false);
        assertTrue(card.mintTimestamp > 0);
    }

    function test_VerifyAttestation_Success() public {
        vm.prank(minter);
        uint256 tokenId = cardCollection.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        assertTrue(cardCollection.verifyAttestation(tokenId, RAW_DATA));
        assertFalse(cardCollection.verifyAttestation(tokenId, "WrongData"));
    }

    function test_SetCardLock_Success() public {
        vm.prank(minter);
        uint256 tokenId = cardCollection.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(admin);
        cardCollection.setCardLock(tokenId, true);

        assertTrue(cardCollection.getCard(tokenId).isLocked);
    }

    function test_RevertIf_UnauthorizedMinter() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardCollection.UnauthorizedMinter.selector, user));
        cardCollection.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_ZeroAddressRecipient() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiCardCollection.ZeroAddressRecipient.selector);
        cardCollection.mintCard(address(0), TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_InvalidAttestationHash() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiCardCollection.InvalidAttestationHash.selector);
        cardCollection.mintCard(user, bytes32(0), "ipfs://QmTestHash");
    }

    function test_RevertIf_TokenDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardCollection.TokenDoesNotExist.selector, 999));
        cardCollection.getCard(999);

        vm.expectRevert(abi.encodeWithSelector(HoloFiCardCollection.TokenDoesNotExist.selector, 999));
        cardCollection.verifyAttestation(999, RAW_DATA);
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before contract implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `HoloFiCardCollection.sol`.

- [ ] **Step 3: Implement `contracts/HoloFiCardCollection.sol`**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC721URIStorage, ERC721 } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiCardCollection
 * @notice Permissioned ERC-721 collection representing physical TCG cards vaulted by Blink.
 */
contract HoloFiCardCollection is ERC721URIStorage {
    struct CardMetadata {
        uint256 tokenId;
        bytes32 attestationHash;
        uint256 mintTimestamp;
        bool isLocked;
    }

    mapping(uint256 => CardMetadata) public cards;
    uint256 public nextTokenId;
    AccessControlManager public immutable acm;

    event CardMinted(uint256 indexed tokenId, address indexed to, bytes32 indexed attestationHash, string tokenUri);
    event CardLockUpdated(uint256 indexed tokenId, bool isLocked);

    error ZeroAddressACM();
    error ZeroAddressRecipient();
    error InvalidAttestationHash();
    error UnauthorizedMinter(address caller);
    error UnauthorizedLockOperator(address caller);
    error TokenDoesNotExist(uint256 tokenId);

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

    function mintCard(
        address to,
        bytes32 attestationHash,
        string calldata tokenUri
    ) external returns (uint256) {
        if (!acm.hasRole(acm.MINTER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedMinter(msg.sender);
        }
        if (to == address(0)) {
            revert ZeroAddressRecipient();
        }
        if (attestationHash == bytes32(0)) {
            revert InvalidAttestationHash();
        }

        uint256 tokenId = nextTokenId++;

        cards[tokenId] = CardMetadata({
            tokenId: tokenId,
            attestationHash: attestationHash,
            mintTimestamp: block.timestamp,
            isLocked: false
        });

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);

        emit CardMinted(tokenId, to, attestationHash, tokenUri);
        return tokenId;
    }

    function setCardLock(uint256 tokenId, bool isLocked) external {
        if (_ownerOf(tokenId) == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLockOperator(msg.sender);
        }

        cards[tokenId].isLocked = isLocked;
        emit CardLockUpdated(tokenId, isLocked);
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
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS (20 passing: 11 AccessControlManager + 9 HoloFiCardCollection).

- [ ] **Step 5: Commit Task 2**

```bash
git add contracts/HoloFiCardCollection.sol contracts/HoloFiCardCollection.t.sol
git commit -m "feat(HF-12): implement HoloFiCardCollection contract and Solidity tests (relates to HF-12)"
```

---

### Task 3: Implement TypeScript Integration Tests (`test/HoloFiCardCollection.ts`)

**Files:**
- Create: `test/HoloFiCardCollection.ts`

**Interfaces:**
- Consumes: `HoloFiCardCollection` contract methods (`mintCard`, `verifyAttestation`, `getCard`, `setCardLock`).

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiCardCollection.ts`)**

```ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiCardCollection Integration Tests", function () {
  async function deployCardCollectionFixture() {
    const [owner, admin, minter, user, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const minterRole = await acm.MINTER_ROLE();
    await acm.connect(admin).grantRole(minterRole, minter.address);

    const cardCollection = await ethers.deployContract("HoloFiCardCollection", [
      "HoloFi TCG Cards",
      "HFC",
      await acm.getAddress(),
    ]);

    return { acm, cardCollection, owner, admin, minter, user, unauthorized };
  }

  it("Should allow minter to mint card and emit CardMinted event", async function () {
    const { cardCollection, minter, user } = await networkHelpers.loadFixture(deployCardCollectionFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:PSA:10:999"));
    const tokenUri = "ipfs://QmTestURI";

    await expect(cardCollection.connect(minter).mintCard(user.address, attestationHash, tokenUri))
      .to.emit(cardCollection, "CardMinted")
      .withArgs(1n, user.address, attestationHash, tokenUri);

    expect(await cardCollection.ownerOf(1n)).to.equal(user.address);
    expect(await cardCollection.tokenURI(1n)).to.equal(tokenUri);
  });

  it("Should verify raw attestation data correctly", async function () {
    const { cardCollection, minter, user } = await networkHelpers.loadFixture(deployCardCollectionFixture);
    const rawData = ethers.toUtf8Bytes("Blink:PSA:10:999");
    const attestationHash = ethers.keccak256(rawData);

    await cardCollection.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");

    expect(await cardCollection.verifyAttestation(1n, rawData)).to.be.true;
    expect(await cardCollection.verifyAttestation(1n, ethers.toUtf8Bytes("WrongData"))).to.be.false;
  });

  it("Should allow admin to update card lock status", async function () {
    const { cardCollection, admin, minter, user } = await networkHelpers.loadFixture(deployCardCollectionFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await cardCollection.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");

    await expect(cardCollection.connect(admin).setCardLock(1n, true))
      .to.emit(cardCollection, "CardLockUpdated")
      .withArgs(1n, true);

    const card = await cardCollection.getCard(1n);
    expect(card.isLocked).to.be.true;
  });

  it("Should revert when unauthorized user attempts to mint", async function () {
    const { cardCollection, unauthorized, user } = await networkHelpers.loadFixture(deployCardCollectionFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await expect(
      cardCollection.connect(unauthorized).mintCard(user.address, attestationHash, "ipfs://QmURI")
    ).to.be.revertedWithCustomError(cardCollection, "UnauthorizedMinter")
     .withArgs(unauthorized.address);
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (24 passing: 20 Solidity + 4 TypeScript).

- [ ] **Step 3: Commit Task 3 with Linear Magic Word**

```bash
git add test/HoloFiCardCollection.ts
git commit -m "test(HF-12): add TypeScript integration tests for HoloFiCardCollection (Fixes HF-12)"
```
