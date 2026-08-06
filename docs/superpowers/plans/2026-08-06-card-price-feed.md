# `HoloFiCardPriceFeed` Smart Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `HoloFiCardPriceFeed.sol`, a gas-optimized Fair Market Value (FMV) price feed registry storing packed 128-bit prices and timestamps per TCG card model, with role-gated access control for `ORACLE_ROLE`.

**Architecture:** Create `contracts/HoloFiCardPriceFeed.sol` inheriting AccessControl integration via `AccessControlManager`. Store prices in packed 256-bit struct (`uint128 price`, `uint128 lastUpdated`). Implement single and batch price update functions and public getters. Cover with 100% Solidity unit tests (`contracts/HoloFiCardPriceFeed.t.sol`) and TypeScript integration tests (`test/HoloFiCardPriceFeed.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `HoloFiCardPriceFeed.sol` Contract & Solidity Unit Tests

**Files:**
- Create: `contracts/HoloFiCardPriceFeed.sol`
- Create: `contracts/HoloFiCardPriceFeed.t.sol`

**Interfaces:**
- Produces: `HoloFiCardPriceFeed` contract with `setPrice`, `setBatchPrices`, `getPrice`, and `getLatestPriceData`.

- [ ] **Step 1: Create `contracts/HoloFiCardPriceFeed.t.sol` with unit tests**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardPriceFeed } from "./HoloFiCardPriceFeed.sol";

contract HoloFiCardPriceFeedTest is Test {
    AccessControlManager public acm;
    HoloFiCardPriceFeed public priceFeed;

    address public admin = address(0x1);
    address public oracle = address(0x2);
    address public user = address(0x3);

    bytes32 public cardTypeId1 = keccak256("Pikachu_Illustrator_PSA10");
    bytes32 public cardTypeId2 = keccak256("Charizard_1st_Edition_PSA10");

    function setUp() public {
        acm = new AccessControlManager(admin);
        priceFeed = new HoloFiCardPriceFeed(address(acm));

        vm.startPrank(admin);
        acm.grantRole(acm.ORACLE_ROLE(), oracle);
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(priceFeed.acm()), address(acm));
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(HoloFiCardPriceFeed.ZeroAddressACM.selector);
        new HoloFiCardPriceFeed(address(0));
    }

    function test_SetPrice_Success() public {
        uint128 price = 50_000 * 1e18;
        vm.prank(oracle);
        priceFeed.setPrice(cardTypeId1, price);

        (uint256 fetchedPrice, bool isValid) = priceFeed.getPrice(cardTypeId1);
        assertTrue(isValid);
        assertEq(fetchedPrice, price);

        (uint128 p, uint128 lastUpdated, bool valid) = priceFeed.getLatestPriceData(cardTypeId1);
        assertTrue(valid);
        assertEq(p, price);
        assertEq(lastUpdated, block.timestamp);
    }

    function test_RevertIf_SetPrice_Unauthorized() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiCardPriceFeed.UnauthorizedOracle.selector, user));
        priceFeed.setPrice(cardTypeId1, 100 * 1e18);
    }

    function test_RevertIf_SetPrice_ZeroPrice() public {
        vm.prank(oracle);
        vm.expectRevert(HoloFiCardPriceFeed.ZeroPrice.selector);
        priceFeed.setPrice(cardTypeId1, 0);
    }

    function test_SetBatchPrices_Success() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cardTypeId1;
        ids[1] = cardTypeId2;

        uint128[] memory p = new uint128[](2);
        p[0] = 50_000 * 1e18;
        p[1] = 150_000 * 1e18;

        vm.prank(oracle);
        priceFeed.setBatchPrices(ids, p);

        (uint256 p1, bool v1) = priceFeed.getPrice(cardTypeId1);
        (uint256 p2, bool v2) = priceFeed.getPrice(cardTypeId2);
        assertTrue(v1);
        assertTrue(v2);
        assertEq(p1, p[0]);
        assertEq(p2, p[1]);
    }

    function test_RevertIf_SetBatchPrices_LengthMismatch() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cardTypeId1;
        ids[1] = cardTypeId2;

        uint128[] memory p = new uint128[](1);
        p[0] = 50_000 * 1e18;

        vm.prank(oracle);
        vm.expectRevert(HoloFiCardPriceFeed.ArrayLengthMismatch.selector);
        priceFeed.setBatchPrices(ids, p);
    }

    function test_GetPrice_Uninitialized() public view {
        (uint256 price, bool isValid) = priceFeed.getPrice(cardTypeId1);
        assertFalse(isValid);
        assertEq(price, 0);
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before contract creation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `HoloFiCardPriceFeed.sol`.

- [ ] **Step 3: Create `contracts/HoloFiCardPriceFeed.sol`**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiCardPriceFeed
 * @notice Gas-optimized Fair Market Value (FMV) price feed registry for TCG card models.
 */
contract HoloFiCardPriceFeed {
    struct PriceData {
        uint128 price;       // 18-decimal USD Fair Market Value
        uint128 lastUpdated; // Block timestamp of price update
    }

    AccessControlManager public immutable acm;
    mapping(bytes32 => PriceData) public prices;

    error ZeroAddressACM();
    error UnauthorizedOracle(address caller);
    error ZeroPrice();
    error ArrayLengthMismatch();

    event PriceUpdated(bytes32 indexed cardTypeId, uint128 price, uint128 timestamp);

    modifier onlyOracle() {
        if (!acm.hasRole(acm.ORACLE_ROLE(), msg.sender)) {
            revert UnauthorizedOracle(msg.sender);
        }
        _;
    }

    constructor(address _acm) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

    function setPrice(bytes32 cardTypeId, uint128 price) external onlyOracle {
        if (price == 0) {
            revert ZeroPrice();
        }
        prices[cardTypeId] = PriceData({
            price: price,
            lastUpdated: uint128(block.timestamp)
        });
        emit PriceUpdated(cardTypeId, price, uint128(block.timestamp));
    }

    function setBatchPrices(
        bytes32[] calldata cardTypeIds,
        uint128[] calldata newPrices
    ) external onlyOracle {
        uint256 len = cardTypeIds.length;
        if (len != newPrices.length) {
            revert ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < len; i++) {
            uint128 price = newPrices[i];
            if (price == 0) {
                revert ZeroPrice();
            }
            bytes32 cardTypeId = cardTypeIds[i];
            prices[cardTypeId] = PriceData({
                price: price,
                lastUpdated: uint128(block.timestamp)
            });
            emit PriceUpdated(cardTypeId, price, uint128(block.timestamp));
        }
    }

    function getPrice(bytes32 cardTypeId) external view returns (uint256 price, bool isValid) {
        PriceData memory data = prices[cardTypeId];
        if (data.price == 0) {
            return (0, false);
        }
        return (uint256(data.price), true);
    }

    function getLatestPriceData(
        bytes32 cardTypeId
    ) external view returns (uint128 price, uint128 lastUpdated, bool isValid) {
        PriceData memory data = prices[cardTypeId];
        if (data.price == 0) {
            return (0, 0, false);
        }
        return (data.price, data.lastUpdated, true);
    }
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (113 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiCardPriceFeed.sol contracts/HoloFiCardPriceFeed.t.sol
git commit -m "feat(HF-17): implement HoloFiCardPriceFeed smart contract and Solidity unit tests (relates to HF-17)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiCardPriceFeed.ts`)

**Files:**
- Create: `test/HoloFiCardPriceFeed.ts`

**Interfaces:**
- Produces: TypeScript integration tests verifying deployment, role enforcement, and batch price queries.

- [ ] **Step 1: Create `test/HoloFiCardPriceFeed.ts`**

```ts
import { expect } from "chai";
import { ethers, networkHelpers } from "hardhat";

describe("HoloFiCardPriceFeed Integration Tests", function () {
  async function deployPriceFeedFixture() {
    const [owner, admin, oracle, user] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const priceFeed = await ethers.deployContract("HoloFiCardPriceFeed", [await acm.getAddress()]);

    const oracleRole = await acm.ORACLE_ROLE();
    await acm.connect(admin).grantRole(oracleRole, oracle.address);

    const cardTypeId1 = ethers.keccak256(ethers.toUtf8Bytes("Charizard_1st_Edition"));
    const cardTypeId2 = ethers.keccak256(ethers.toUtf8Bytes("Pikachu_Illustrator"));

    return { acm, priceFeed, owner, admin, oracle, user, cardTypeId1, cardTypeId2 };
  }

  it("Should set single price and query correctly", async function () {
    const { priceFeed, oracle, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price = ethers.parseUnits("50000", 18);
    await expect(priceFeed.connect(oracle).setPrice(cardTypeId1, price))
      .to.emit(priceFeed, "PriceUpdated");

    const [fetchedPrice, isValid] = await priceFeed.getPrice(cardTypeId1);
    expect(isValid).to.be.true;
    expect(fetchedPrice).to.equal(price);
  });

  it("Should revert when unauthorized user attempts to set price", async function () {
    const { priceFeed, user, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price = ethers.parseUnits("50000", 18);
    await expect(priceFeed.connect(user).setPrice(cardTypeId1, price))
      .to.be.revertedWithCustomError(priceFeed, "UnauthorizedOracle")
      .withArgs(user.address);
  });

  it("Should revert when setting price to zero", async function () {
    const { priceFeed, oracle, cardTypeId1 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    await expect(priceFeed.connect(oracle).setPrice(cardTypeId1, 0n))
      .to.be.revertedWithCustomError(priceFeed, "ZeroPrice");
  });

  it("Should set batch prices correctly", async function () {
    const { priceFeed, oracle, cardTypeId1, cardTypeId2 } = await networkHelpers.loadFixture(deployPriceFeedFixture);

    const price1 = ethers.parseUnits("50000", 18);
    const price2 = ethers.parseUnits("150000", 18);

    await priceFeed.connect(oracle).setBatchPrices([cardTypeId1, cardTypeId2], [price1, price2]);

    const [p1, v1] = await priceFeed.getPrice(cardTypeId1);
    const [p2, v2] = await priceFeed.getPrice(cardTypeId2);

    expect(v1).to.be.true;
    expect(v2).to.be.true;
    expect(p1).to.equal(price1);
    expect(p2).to.equal(price2);
  });

  it("Should revert constructor with zero address ACM", async function () {
    await expect(ethers.deployContract("HoloFiCardPriceFeed", [ethers.ZeroAddress]))
      .to.be.revertedWithCustomError(await ethers.getContractFactory("HoloFiCardPriceFeed"), "ZeroAddressACM");
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (144 total tests: 113 Solidity + 31 Mocha/TypeScript).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiCardPriceFeed.ts
git commit -m "test(HF-17): add TypeScript integration tests for HoloFiCardPriceFeed (Fixes HF-17)"
```
