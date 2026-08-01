# Multi-Asset Pool Factory (`HoloFiLendingPoolFactory`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and test `HoloFiLendingPoolFactory.sol` to enable `ADMIN_ROLE` to deploy permissioned `HoloFiLendingPool` instances per supported underlying ERC-20 asset with an on-chain lookup registry.

**Architecture:** `HoloFiLendingPoolFactory.sol` links to `AccessControlManager`, validates authorization (`ADMIN_ROLE`), deploys new `HoloFiLendingPool` instances, registers `getPool[underlyingAsset] = poolAddress`, tracks pool addresses in `allPools`, and prevents duplicate pool creation for the same underlying asset. Tested via Solidity unit tests (`contracts/HoloFiLendingPoolFactory.t.sol`) and TypeScript integration tests (`test/HoloFiLendingPoolFactory.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement `HoloFiLendingPoolFactory.sol` & Solidity Unit Tests

**Files:**
- Create: `contracts/HoloFiLendingPoolFactory.sol`
- Create: `contracts/HoloFiLendingPoolFactory.t.sol`

**Interfaces:**
- Produces: `HoloFiLendingPoolFactory` contract with `getPool(address) -> address`, `allPools(uint256) -> address`, `createPool(IERC20 asset, string name, string symbol) -> address`, `allPoolsLength() -> uint256`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiLendingPoolFactory.t.sol`)**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract HoloFiLendingPoolFactoryTest is Test {
    AccessControlManager public acm;
    HoloFiLendingPoolFactory public factory;
    MockERC20 public eurc;
    MockERC20 public weth;

    address public admin = address(0x1111);
    address public user = address(0x3333);

    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);

    function setUp() public {
        acm = new AccessControlManager(admin);
        factory = new HoloFiLendingPoolFactory(address(acm));
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(factory.acm()), address(acm));
        assertEq(factory.allPoolsLength(), 0);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPoolFactory.ZeroAddressACM.selector));
        new HoloFiLendingPoolFactory(address(0));
    }

    function test_CreatePool_AdminSuccess() public {
        vm.prank(admin);
        address poolAddr = factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");

        assertTrue(poolAddr != address(0));
        assertEq(factory.getPool(address(eurc)), poolAddr);
        assertEq(factory.allPools(0), poolAddr);
        assertEq(factory.allPoolsLength(), 1);

        HoloFiLendingPool pool = HoloFiLendingPool(poolAddr);
        assertEq(address(pool.asset()), address(eurc));
        assertEq(pool.name(), "HoloFi Pool EURC");
        assertEq(pool.symbol(), "pEURC");
    }

    function test_RevertIf_UnauthorizedCreatePool() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiLendingPoolFactory.UnauthorizedOperator.selector, user)
        );
        factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");
    }

    function test_RevertIf_CreatePool_ZeroAddressAsset() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(HoloFiLendingPoolFactory.ZeroAddressAsset.selector));
        factory.createPool(IERC20(address(0)), "HoloFi Pool EURC", "pEURC");
    }

    function test_RevertIf_CreatePool_AlreadyExists() public {
        vm.prank(admin);
        address existingPool = factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiLendingPoolFactory.PoolAlreadyExists.selector,
                address(eurc),
                existingPool
            )
        );
        factory.createPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC");
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `HoloFiLendingPoolFactory.sol`.

- [ ] **Step 3: Implement `contracts/HoloFiLendingPoolFactory.sol`**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";

/**
 * @title HoloFiLendingPoolFactory
 * @notice Factory for deploying and registering permissioned HoloFiLendingPool instances per underlying asset.
 */
contract HoloFiLendingPoolFactory {
    AccessControlManager public immutable acm;
    mapping(address => address) public getPool;
    address[] public allPools;

    event PoolCreated(address indexed underlyingAsset, address poolAddress, string name, string symbol);

    error ZeroAddressACM();
    error ZeroAddressAsset();
    error PoolAlreadyExists(address underlyingAsset, address existingPool);
    error UnauthorizedOperator(address caller);

    constructor(address _acm) {
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

    function createPool(
        IERC20 asset,
        string calldata name,
        string calldata symbol
    ) external returns (address pool) {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedOperator(msg.sender);
        }
        if (address(asset) == address(0)) {
            revert ZeroAddressAsset();
        }
        address existingPool = getPool[address(asset)];
        if (existingPool != address(0)) {
            revert PoolAlreadyExists(address(asset), existingPool);
        }

        HoloFiLendingPool poolContract = new HoloFiLendingPool(asset, name, symbol, address(acm));
        pool = address(poolContract);

        getPool[address(asset)] = pool;
        allPools.push(pool);

        emit PoolCreated(address(asset), pool, name, symbol);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (46 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiLendingPoolFactory.sol contracts/HoloFiLendingPoolFactory.t.sol
git commit -m "feat(HF-30): implement HoloFiLendingPoolFactory contract and Solidity tests (relates to HF-30)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiLendingPoolFactory.ts`)

**Files:**
- Create: `test/HoloFiLendingPoolFactory.ts`

**Interfaces:**
- Consumes: `HoloFiLendingPoolFactory` methods (`createPool`, `getPool`, `allPools`, `allPoolsLength`).

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiLendingPoolFactory.ts`)**

```ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiLendingPoolFactory Integration Tests", function () {
  async function deployFactoryFixture() {
    const [owner, admin, user, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const factory = await ethers.deployContract("HoloFiLendingPoolFactory", [await acm.getAddress()]);
    const eurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const weth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);

    return { acm, factory, eurc, weth, owner, admin, user, unauthorized };
  }

  it("Should allow admin to deploy pool and register in lookup mapping", async function () {
    const { factory, eurc, weth, admin } = await networkHelpers.loadFixture(deployFactoryFixture);

    const eurcAddr = await eurc.getAddress();
    const wethAddr = await weth.getAddress();

    await expect(factory.connect(admin).createPool(eurcAddr, "HoloFi Pool EURC", "pEURC"))
      .to.emit(factory, "PoolCreated");

    const eurcPoolAddr = await factory.getPool(eurcAddr);
    expect(eurcPoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(await factory.allPools(0n)).to.equal(eurcPoolAddr);

    await expect(factory.connect(admin).createPool(wethAddr, "HoloFi Pool WETH", "pWETH"))
      .to.emit(factory, "PoolCreated");

    const wethPoolAddr = await factory.getPool(wethAddr);
    expect(wethPoolAddr).to.not.equal(ethers.ZeroAddress);
    expect(await factory.allPoolsLength()).to.equal(2n);
  });

  it("Should revert when creating duplicate pool for same asset", async function () {
    const { factory, eurc, admin } = await networkHelpers.loadFixture(deployFactoryFixture);
    const eurcAddr = await eurc.getAddress();

    await factory.connect(admin).createPool(eurcAddr, "HoloFi Pool EURC", "pEURC");
    const existingPool = await factory.getPool(eurcAddr);

    await expect(
      factory.connect(admin).createPool(eurcAddr, "HoloFi Pool EURC", "pEURC")
    ).to.be.revertedWithCustomError(factory, "PoolAlreadyExists")
     .withArgs(eurcAddr, existingPool);
  });

  it("Should revert when unauthorized user attempts to create pool", async function () {
    const { factory, eurc, unauthorized } = await networkHelpers.loadFixture(deployFactoryFixture);
    const eurcAddr = await eurc.getAddress();

    await expect(
      factory.connect(unauthorized).createPool(eurcAddr, "HoloFi Pool EURC", "pEURC")
    ).to.be.revertedWithCustomError(factory, "UnauthorizedOperator")
     .withArgs(unauthorized.address);
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (67 total tests: 46 Solidity + 21 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiLendingPoolFactory.ts
git commit -m "test(HF-30): add TypeScript integration tests for HoloFiLendingPoolFactory (Fixes HF-30)"
```
