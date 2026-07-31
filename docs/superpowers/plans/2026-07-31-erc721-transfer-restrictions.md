# ERC-721 Transfer Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disallow transfers of locked `HoloFiCardCollection` NFTs while allowing unlocked NFTs to transfer freely between standard wallets.

**Architecture:** Override `_update` in `HoloFiCardCollection.sol` to check `cards[tokenId].isLocked` during transfers and revert with `CardIsLocked(tokenId)` when true. Tested via Solidity unit tests (`contracts/HoloFiCardCollection.t.sol`) and TypeScript integration tests (`test/HoloFiCardCollection.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use `(Fixes HF-14)` for closing commits or `(relates to HF-14)` for non-closing commits
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Lock Transfer Restriction in `HoloFiCardCollection.sol` & Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiCardCollection.sol`
- Modify: `contracts/HoloFiCardCollection.t.sol`

**Interfaces:**
- Produces: `error CardIsLocked(uint256 tokenId)`, overridden `_update(address to, uint256 tokenId, address auth)` hook.

- [ ] **Step 1: Write Solidity Unit Test Cases in `contracts/HoloFiCardCollection.t.sol`**

Add unit tests to `contracts/HoloFiCardCollection.t.sol`:

```solidity
    function test_Transfer_UnlockedCard_Success() public {
        vm.prank(minter);
        uint256 tokenId = cardCollection.mintCard(user, TEST_ATTESTATION, "ipfs://QmURI");

        vm.prank(user);
        cardCollection.transferFrom(user, admin, tokenId);

        assertEq(cardCollection.ownerOf(tokenId), admin);
    }

    function test_RevertIf_TransferLockedCard() public {
        vm.prank(minter);
        uint256 tokenId = cardCollection.mintCard(user, TEST_ATTESTATION, "ipfs://QmURI");

        vm.prank(admin);
        cardCollection.setCardLock(tokenId, true);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardCollection.CardIsLocked.selector, tokenId));
        cardCollection.transferFrom(user, admin, tokenId);
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `CardIsLocked` error and transfer hook in `HoloFiCardCollection.sol`.

- [ ] **Step 3: Update `contracts/HoloFiCardCollection.sol` Implementation**

Add to `contracts/HoloFiCardCollection.sol`:

```solidity
    error CardIsLocked(uint256 tokenId);

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0) && to != address(0)) {
            if (cards[tokenId].isLocked) {
                revert CardIsLocked(tokenId);
            }
        }

        return super._update(to, tokenId, auth);
    }
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS (24 passing: 12 HoloFiCardCollection + 12 AccessControlManager).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiCardCollection.sol contracts/HoloFiCardCollection.t.sol
git commit -m "feat(HF-14): implement ERC-721 transfer restrictions and Solidity unit tests (relates to HF-14)"
```

---

### Task 2: Extend TypeScript Integration Tests (`test/HoloFiCardCollection.ts`)

**Files:**
- Modify: `test/HoloFiCardCollection.ts`

**Interfaces:**
- Consumes: `transferFrom`, `setCardLock`, `CardIsLocked`.

- [ ] **Step 1: Add Integration Tests to `test/HoloFiCardCollection.ts`**

Add tests to `test/HoloFiCardCollection.ts`:

```ts
  it("Should allow unlocked card transfers freely between wallets", async function () {
    const { cardCollection, minter, user, unauthorized } = await networkHelpers.loadFixture(deployCardCollectionFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await cardCollection.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");

    await cardCollection.connect(user).transferFrom(user.address, unauthorized.address, 1n);
    expect(await cardCollection.ownerOf(1n)).to.equal(unauthorized.address);
  });

  it("Should revert transfer of locked card with custom error CardIsLocked", async function () {
    const { cardCollection, admin, minter, user, unauthorized } = await networkHelpers.loadFixture(deployCardCollectionFixture);
    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("Blink:Cert"));

    await cardCollection.connect(minter).mintCard(user.address, attestationHash, "ipfs://QmURI");
    await cardCollection.connect(admin).setCardLock(1n, true);

    await expect(
      cardCollection.connect(user).transferFrom(user.address, unauthorized.address, 1n)
    ).to.be.revertedWithCustomError(cardCollection, "CardIsLocked")
     .withArgs(1n);

    await cardCollection.connect(admin).setCardLock(1n, false);
    await cardCollection.connect(user).transferFrom(user.address, unauthorized.address, 1n);
    expect(await cardCollection.ownerOf(1n)).to.equal(unauthorized.address);
  });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS (37 passing: 24 Solidity + 13 TypeScript).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiCardCollection.ts
git commit -m "test(HF-14): add TypeScript integration tests for ERC-721 transfer restrictions (Fixes HF-14)"
```
