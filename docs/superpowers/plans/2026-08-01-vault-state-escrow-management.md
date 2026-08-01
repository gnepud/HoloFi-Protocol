# Vault State & Escrow Management (`HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and test `HoloFiVaultLoanCore.sol` to provide isolated vault accounting for KYB-approved boutiques and escrow management for `HoloFiCardCollection` ERC-721 card NFTs.

**Architecture:** `HoloFiVaultLoanCore.sol` integrates with `AccessControlManager` (KYB checks on `createVault`) and `HoloFiCardCollection` (locking and escrowing NFTs via `safeTransferFrom` and `setCardLock`). Maintains `CollateralVault` state and token mapping lookups (`nftVaultId`). Tested via Solidity unit tests (`contracts/HoloFiVaultLoanCore.t.sol`) and TypeScript integration tests (`test/HoloFiVaultLoanCore.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `HoloFiVaultLoanCore.sol` & Solidity Unit Tests

**Files:**
- Create: `contracts/HoloFiVaultLoanCore.sol`
- Create: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: `HoloFiVaultLoanCore` contract with `createVault() -> uint256`, `depositCollateral(uint256 vaultId, uint256[] tokenIds)`, `withdrawCollateral(uint256 vaultId, uint256[] tokenIds)`, `getVault(uint256) -> CollateralVault`, `getVaultTokenIds(uint256) -> uint256[]`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiVaultLoanCore.t.sol`)**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract HoloFiVaultLoanCoreTest is Test, IERC721Receiver {
    AccessControlManager public acm;
    HoloFiCardCollection public cardCollection;
    HoloFiVaultLoanCore public loanCore;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public boutique = address(0x3333);
    address public unauthorized = address(0x4444);

    uint256 public cardId1;
    uint256 public cardId2;

    event VaultCreated(uint256 indexed vaultId, address indexed owner);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function setUp() public {
        acm = new AccessControlManager(admin);
        cardCollection = new HoloFiCardCollection(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(cardCollection));

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);
        acm.setKybStatus(boutique, true);
        vm.stopPrank();

        bytes32 attestationHash = keccak256("raw_data_1");
        vm.prank(minter);
        cardId1 = cardCollection.mintCard(boutique, "ipfs://card1", attestationHash);

        bytes32 attestationHash2 = keccak256("raw_data_2");
        vm.prank(minter);
        cardId2 = cardCollection.mintCard(boutique, "ipfs://card2", attestationHash2);
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(loanCore.acm()), address(acm));
        assertEq(address(loanCore.nftCollection()), address(cardCollection));
        assertEq(loanCore.nextVaultId(), 1);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressACM.selector));
        new HoloFiVaultLoanCore(address(0), address(cardCollection));
    }

    function test_RevertIf_Constructor_ZeroAddressNFT() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressNFT.selector));
        new HoloFiVaultLoanCore(address(acm), address(0));
    }

    function test_CreateVault_KybApprovedSuccess() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        assertEq(vaultId, 1);
        assertEq(loanCore.nextVaultId(), 2);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.vaultId, 1);
        assertEq(vault.owner, boutique);
        assertEq(vault.principalDebt, 0);
        assertEq(vault.accumulatedInterest, 0);
        assertTrue(vault.status == HoloFiVaultLoanCore.VaultStatus.Active);
    }

    function test_RevertIf_CreateVault_NonKyb() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.KybRequired.selector, unauthorized));
        loanCore.createVault();
    }

    function test_DepositCollateral_Success() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        vm.prank(boutique);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(boutique);
        loanCore.depositCollateral(vaultId, tokenIds);

        assertEq(cardCollection.ownerOf(cardId1), address(loanCore));
        assertEq(cardCollection.ownerOf(cardId2), address(loanCore));

        (,, bool isLocked1) = cardCollection.getCard(cardId1);
        (,, bool isLocked2) = cardCollection.getCard(cardId2);
        assertTrue(isLocked1);
        assertTrue(isLocked2);

        assertEq(loanCore.nftVaultId(cardId1), vaultId);
        assertEq(loanCore.nftVaultId(cardId2), vaultId);

        uint256[] memory vaultTokens = loanCore.getVaultTokenIds(vaultId);
        assertEq(vaultTokens.length, 2);
        assertEq(vaultTokens[0], cardId1);
        assertEq(vaultTokens[1], cardId2);
    }

    function test_RevertIf_DepositCollateral_UnauthorizedOwner() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.depositCollateral(vaultId, tokenIds);
    }

    function test_WithdrawCollateral_Success() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        vm.prank(boutique);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(boutique);
        loanCore.depositCollateral(vaultId, tokenIds);

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(boutique);
        loanCore.withdrawCollateral(vaultId, withdrawTokens);

        assertEq(cardCollection.ownerOf(cardId1), boutique);
        (,, bool isLocked1) = cardCollection.getCard(cardId1);
        assertFalse(isLocked1);
        assertEq(loanCore.nftVaultId(cardId1), 0);

        uint256[] memory remainingTokens = loanCore.getVaultTokenIds(vaultId);
        assertEq(remainingTokens.length, 1);
        assertEq(remainingTokens[0], cardId2);
    }

    function test_RevertIf_WithdrawCollateral_NonVaultToken() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(boutique);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiVaultLoanCore.TokenNotInVault.selector, cardId1, vaultId)
        );
        loanCore.withdrawCollateral(vaultId, withdrawTokens);
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `HoloFiVaultLoanCore.sol`.

- [ ] **Step 3: Implement `contracts/HoloFiVaultLoanCore.sol`**

```solidity
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
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (55 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-20): implement HoloFiVaultLoanCore contract and Solidity tests (relates to HF-20)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)

**Files:**
- Create: `test/HoloFiVaultLoanCore.ts`

**Interfaces:**
- Consumes: `createVault`, `depositCollateral`, `withdrawCollateral`, `getVault`, `getVaultTokenIds`.

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)**

```ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiVaultLoanCore Integration Tests", function () {
  async function deployLoanCoreFixture() {
    const [owner, admin, minter, boutique, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const cardCollection = await ethers.deployContract("HoloFiCardCollection", [await acm.getAddress()]);
    const loanCore = await ethers.deployContract("HoloFiVaultLoanCore", [
      await acm.getAddress(),
      await cardCollection.getAddress(),
    ]);

    const minterRole = await acm.MINTER_ROLE();
    await acm.connect(admin).grantRole(minterRole, minter.address);
    await acm.connect(admin).setKybStatus(boutique.address, true);

    const attestationHash1 = ethers.keccak256(ethers.toUtf8Bytes("attestation1"));
    const attestationHash2 = ethers.keccak256(ethers.toUtf8Bytes("attestation2"));

    await cardCollection.connect(minter).mintCard(boutique.address, "ipfs://card1", attestationHash1);
    await cardCollection.connect(minter).mintCard(boutique.address, "ipfs://card2", attestationHash2);

    return { acm, cardCollection, loanCore, owner, admin, minter, boutique, unauthorized };
  }

  it("Should allow KYB approved boutique to create vault and escrow/withdraw cards", async function () {
    const { cardCollection, loanCore, boutique } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    const loanCoreAddr = await loanCore.getAddress();

    await expect(loanCore.connect(boutique).createVault())
      .to.emit(loanCore, "VaultCreated")
      .withArgs(1n, boutique.address);

    await cardCollection.connect(boutique).setApprovalForAll(loanCoreAddr, true);

    await expect(loanCore.connect(boutique).depositCollateral(1n, [1n, 2n]))
      .to.emit(loanCore, "CollateralDeposited")
      .withArgs(1n, boutique.address, [1n, 2n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(loanCoreAddr);
    expect(await cardCollection.ownerOf(2n)).to.equal(loanCoreAddr);

    const card1Info = await cardCollection.getCard(1n);
    expect(card1Info.isLocked).to.be.true;

    await expect(loanCore.connect(boutique).withdrawCollateral(1n, [1n]))
      .to.emit(loanCore, "CollateralWithdrawn")
      .withArgs(1n, boutique.address, [1n]);

    expect(await cardCollection.ownerOf(1n)).to.equal(boutique.address);

    const card1InfoUnlocked = await cardCollection.getCard(1n);
    expect(card1InfoUnlocked.isLocked).to.be.false;

    const remainingTokens = await loanCore.getVaultTokenIds(1n);
    expect(remainingTokens.length).to.equal(1);
    expect(remainingTokens[0]).to.equal(2n);
  });

  it("Should revert when non-KYB boutique attempts to create vault", async function () {
    const { loanCore, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await expect(
      loanCore.connect(unauthorized).createVault()
    ).to.be.revertedWithCustomError(loanCore, "KybRequired")
     .withArgs(unauthorized.address);
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (77 total tests: 55 Solidity + 22 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiVaultLoanCore.ts
git commit -m "test(HF-20): add TypeScript integration tests for HoloFiVaultLoanCore (Fixes HF-20)"
```
