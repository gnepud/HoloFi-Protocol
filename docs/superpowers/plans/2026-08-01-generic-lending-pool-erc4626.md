# Generic HoloFiLendingPool ERC-4626 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and test `HoloFiLendingPool.sol` generic permissioned ERC-4626 lending pool accepting single-asset deposits (e.g. USDC, EURC, USDT, WETH) and issuing custom yield-bearing `pToken` shares, integrated with credit engine liquidity controls.

**Architecture:** `HoloFiLendingPool.sol` inherits OpenZeppelin `ERC4626`, accepts dynamic `(asset_, name_, symbol_, _acm)` in constructor, references `AccessControlManager` for role authorization, handles `pToken` share minting & exchange rate math, and exposes `drawLiquidity` / `returnLiquidity` for `HoloFiVaultLoanCore`. Supported by generic `MockERC20.sol` (configurable decimals). Tested via Solidity unit tests (`contracts/HoloFiLendingPool.t.sol`) and TypeScript integration tests (`test/HoloFiLendingPool.ts`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use `(Fixes HF-15)` for closing commits or `(relates to HF-15)` for non-closing commits
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Generic `MockERC20.sol` & Unit Tests

**Files:**
- Create: `contracts/mocks/MockERC20.sol`
- Create: `contracts/mocks/MockERC20.t.sol`

**Interfaces:**
- Produces: `MockERC20` contract with constructor `(string name, string symbol, uint8 decimals)` and `mint(address to, uint256 amount)`.

- [ ] **Step 1: Write Solidity Unit Tests for MockERC20 (`contracts/mocks/MockERC20.t.sol`)**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "./MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 public eurc;
    MockERC20 public weth;
    address public user = address(0x1111);

    function setUp() public {
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
    }

    function test_MockERC20_InitialState() public view {
        assertEq(eurc.name(), "Euro Coin");
        assertEq(eurc.symbol(), "EURC");
        assertEq(eurc.decimals(), 6);

        assertEq(weth.name(), "Wrapped Ether");
        assertEq(weth.symbol(), "WETH");
        assertEq(weth.decimals(), 18);
    }

    function test_MockERC20_Mint() public {
        eurc.mint(user, 1_000_000); // 1 EURC
        assertEq(eurc.balanceOf(user), 1_000_000);

        weth.mint(user, 1e18); // 1 WETH
        assertEq(weth.balanceOf(user), 1e18);
    }
}
```

- [ ] **Step 2: Run Solidity test to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `MockERC20.sol`.

- [ ] **Step 3: Implement `contracts/mocks/MockERC20.sol`**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 customDecimals_
    ) ERC20(name_, symbol_) {
        _customDecimals = customDecimals_;
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly.

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/mocks/MockERC20.sol contracts/mocks/MockERC20.t.sol
git commit -m "feat(HF-15): add MockERC20 contract for testing environment (relates to HF-15)"
```

---

### Task 2: Implement Generic `HoloFiLendingPool.sol` & Solidity Unit Tests

**Files:**
- Create: `contracts/HoloFiLendingPool.sol`
- Create: `contracts/HoloFiLendingPool.t.sol`

**Interfaces:**
- Produces: Generic `HoloFiLendingPool` contract inheriting `ERC4626` with `setLoanCore`, `drawLiquidity`, `returnLiquidity`.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiLendingPool.t.sol`)**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiLendingPool } from "./HoloFiLendingPool.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract HoloFiLendingPoolTest is Test {
    AccessControlManager public acm;
    MockERC20 public eurc;
    MockERC20 public weth;
    HoloFiLendingPool public poolEurc;
    HoloFiLendingPool public poolWeth;

    address public admin = address(0x1111);
    address public loanCore = address(0x2222);
    address public lp = address(0x3333);
    address public borrower = address(0x4444);
    address public unauthorized = address(0x5555);

    function setUp() public {
        acm = new AccessControlManager(admin);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);

        poolEurc = new HoloFiLendingPool(IERC20(address(eurc)), "HoloFi Pool EURC", "pEURC", address(acm));
        poolWeth = new HoloFiLendingPool(IERC20(address(weth)), "HoloFi Pool WETH", "pWETH", address(acm));

        eurc.mint(lp, 10_000 * 1e6);
        weth.mint(lp, 10 * 1e18);

        vm.startPrank(lp);
        eurc.approve(address(poolEurc), type(uint256).max);
        weth.approve(address(poolWeth), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(admin);
        poolEurc.setLoanCore(loanCore);
        poolWeth.setLoanCore(loanCore);
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(poolEurc.asset()), address(eurc));
        assertEq(address(poolEurc.acm()), address(acm));
        assertEq(poolEurc.name(), "HoloFi Pool EURC");
        assertEq(poolEurc.symbol(), "pEURC");
        assertEq(poolEurc.loanCore(), loanCore);

        assertEq(address(poolWeth.asset()), address(weth));
        assertEq(poolWeth.name(), "HoloFi Pool WETH");
        assertEq(poolWeth.symbol(), "pWETH");
    }

    function test_DepositAndRedeem_6Decimals() public {
        vm.prank(lp);
        uint256 shares = poolEurc.deposit(1000 * 1e6, lp);
        assertEq(shares, 1000 * 1e6);
        assertEq(poolEurc.balanceOf(lp), 1000 * 1e6);

        // Inject 500 EURC interest into pool
        eurc.mint(address(poolEurc), 500 * 1e6);

        // Redeem shares
        vm.prank(lp);
        uint256 assetsReturned = poolEurc.redeem(shares, lp, lp);
        assertApproxEqAbs(assetsReturned, 1500 * 1e6, 1);
    }

    function test_DepositAndRedeem_18Decimals() public {
        vm.prank(lp);
        uint256 shares = poolWeth.deposit(1e18, lp);
        assertEq(shares, 1e18);

        // Inject 0.5 WETH interest into pool
        weth.mint(address(poolWeth), 5e17);

        vm.prank(lp);
        uint256 assetsReturned = poolWeth.redeem(shares, lp, lp);
        assertApproxEqAbs(assetsReturned, 1.5e18, 1);
    }

    function test_DrawLiquidity_Success() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(loanCore);
        poolEurc.drawLiquidity(borrower, 400 * 1e6);

        assertEq(eurc.balanceOf(borrower), 400 * 1e6);
        assertEq(eurc.balanceOf(address(poolEurc)), 600 * 1e6);
    }

    function test_RevertIf_InsufficientVaultLiquidity() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(loanCore);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiLendingPool.InsufficientVaultLiquidity.selector,
                1000 * 1e6,
                2000 * 1e6
            )
        );
        poolEurc.drawLiquidity(borrower, 2000 * 1e6);
    }

    function test_ReturnLiquidity_Success() public {
        vm.prank(lp);
        poolEurc.deposit(1000 * 1e6, lp);

        vm.prank(loanCore);
        poolEurc.drawLiquidity(borrower, 400 * 1e6);

        eurc.mint(borrower, 50 * 1e6); // Extra interest
        vm.prank(borrower);
        eurc.approve(address(poolEurc), 450 * 1e6);

        vm.prank(loanCore);
        poolEurc.returnLiquidity(borrower, 450 * 1e6);

        assertEq(eurc.balanceOf(address(poolEurc)), 1050 * 1e6);
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `HoloFiLendingPool.sol`.

- [ ] **Step 3: Implement `contracts/HoloFiLendingPool.sol`**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC4626, ERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { AccessControlManager } from "./AccessControlManager.sol";

/**
 * @title HoloFiLendingPool
 * @notice Generic permissioned ERC-4626 liquidity pool issuing custom pToken share tokens against ERC-20 deposits.
 */
contract HoloFiLendingPool is ERC4626 {
    AccessControlManager public immutable acm;
    address public loanCore;

    event LoanCoreUpdated(address indexed newLoanCore);
    event LiquidityDrawn(address indexed borrower, uint256 amount);
    event LiquidityReturned(address indexed payer, uint256 amount);

    error ZeroAddressAsset();
    error ZeroAddressACM();
    error ZeroAddressLoanCore();
    error UnauthorizedLoanCore(address caller);
    error UnauthorizedAdmin(address caller);
    error InsufficientVaultLiquidity(uint256 available, uint256 required);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address _acm
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        if (address(asset_) == address(0)) {
            revert ZeroAddressAsset();
        }
        if (_acm == address(0)) {
            revert ZeroAddressACM();
        }
        acm = AccessControlManager(_acm);
    }

    function setLoanCore(address _loanCore) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        if (_loanCore == address(0)) {
            revert ZeroAddressLoanCore();
        }

        loanCore = _loanCore;
        emit LoanCoreUpdated(_loanCore);
    }

    function drawLiquidity(address recipient, uint256 amount) external {
        if (msg.sender != loanCore && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (available < amount) {
            revert InsufficientVaultLiquidity(available, amount);
        }

        IERC20(asset()).transfer(recipient, amount);
        emit LiquidityDrawn(recipient, amount);
    }

    function returnLiquidity(address payer, uint256 amount) external {
        if (msg.sender != loanCore && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedLoanCore(msg.sender);
        }

        IERC20(asset()).transferFrom(payer, address(this), amount);
        emit LiquidityReturned(payer, amount);
    }
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly.

- [ ] **Step 5: Commit Task 2**

```bash
git add contracts/HoloFiLendingPool.sol contracts/HoloFiLendingPool.t.sol
git commit -m "feat(HF-15): implement HoloFiLendingPool contract and Solidity tests (relates to HF-15)"
```

---

### Task 3: Implement TypeScript Integration Tests (`test/HoloFiLendingPool.ts`)

**Files:**
- Create: `test/HoloFiLendingPool.ts`

**Interfaces:**
- Consumes: `HoloFiLendingPool` methods across multiple asset types (`deposit`, `redeem`, `setLoanCore`, `drawLiquidity`, `returnLiquidity`).

- [ ] **Step 1: Write TypeScript Integration Tests (`test/HoloFiLendingPool.ts`)**

```ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("HoloFiLendingPool Integration Tests", function () {
  async function deployLendingPoolFixture() {
    const [owner, admin, lp, borrower, fakeLoanCore, unauthorized] = await ethers.getSigners();
    const acm = await ethers.deployContract("AccessControlManager", [admin.address]);
    const mockEurc = await ethers.deployContract("MockERC20", ["Euro Coin", "EURC", 6]);
    const mockWeth = await ethers.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);

    const poolEurc = await ethers.deployContract("HoloFiLendingPool", [
      await mockEurc.getAddress(),
      "HoloFi Pool EURC",
      "pEURC",
      await acm.getAddress(),
    ]);

    const poolWeth = await ethers.deployContract("HoloFiLendingPool", [
      await mockWeth.getAddress(),
      "HoloFi Pool WETH",
      "pWETH",
      await acm.getAddress(),
    ]);

    await mockEurc.mint(lp.address, ethers.parseUnits("10000", 6));
    await mockEurc.connect(lp).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    await mockWeth.mint(lp.address, ethers.parseUnits("10", 18));
    await mockWeth.connect(lp).approve(await poolWeth.getAddress(), ethers.MaxUint256);

    return { acm, mockEurc, mockWeth, poolEurc, poolWeth, owner, admin, lp, borrower, fakeLoanCore, unauthorized };
  }

  it("Should allow LPs to deposit EURC/WETH and receive corresponding pToken shares", async function () {
    const { mockEurc, mockWeth, poolEurc, poolWeth, lp } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    const eurcAmount = ethers.parseUnits("1000", 6);
    await poolEurc.connect(lp).deposit(eurcAmount, lp.address);
    expect(await poolEurc.balanceOf(lp.address)).to.equal(eurcAmount);
    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(eurcAmount);

    const wethAmount = ethers.parseUnits("2", 18);
    await poolWeth.connect(lp).deposit(wethAmount, lp.address);
    expect(await poolWeth.balanceOf(lp.address)).to.equal(wethAmount);
    expect(await mockWeth.balanceOf(await poolWeth.getAddress())).to.equal(wethAmount);
  });

  it("Should allow admin to register loan core and execute liquidity draw/return", async function () {
    const { mockEurc, poolEurc, admin, lp, borrower, fakeLoanCore } = await networkHelpers.loadFixture(deployLendingPoolFixture);
    const depositAmount = ethers.parseUnits("1000", 6);
    const drawAmount = ethers.parseUnits("400", 6);

    await poolEurc.connect(lp).deposit(depositAmount, lp.address);

    await expect(poolEurc.connect(admin).setLoanCore(fakeLoanCore.address))
      .to.emit(poolEurc, "LoanCoreUpdated")
      .withArgs(fakeLoanCore.address);

    await expect(poolEurc.connect(fakeLoanCore).drawLiquidity(borrower.address, drawAmount))
      .to.emit(poolEurc, "LiquidityDrawn")
      .withArgs(borrower.address, drawAmount);

    expect(await mockEurc.balanceOf(borrower.address)).to.equal(drawAmount);

    await mockEurc.mint(borrower.address, ethers.parseUnits("50", 6));
    await mockEurc.connect(borrower).approve(await poolEurc.getAddress(), ethers.MaxUint256);

    const returnAmount = ethers.parseUnits("450", 6);
    await expect(poolEurc.connect(fakeLoanCore).returnLiquidity(borrower.address, returnAmount))
      .to.emit(poolEurc, "LiquidityReturned")
      .withArgs(borrower.address, returnAmount);

    expect(await mockEurc.balanceOf(await poolEurc.getAddress())).to.equal(ethers.parseUnits("1050", 6));
  });

  it("Should revert when unauthorized caller attempts draw or setLoanCore", async function () {
    const { poolEurc, unauthorized, borrower, fakeLoanCore } = await networkHelpers.loadFixture(deployLendingPoolFixture);

    await expect(
      poolEurc.connect(unauthorized).setLoanCore(fakeLoanCore.address)
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedAdmin")
     .withArgs(unauthorized.address);

    await expect(
      poolEurc.connect(unauthorized).drawLiquidity(borrower.address, 100n)
    ).to.be.revertedWithCustomError(poolEurc, "UnauthorizedLoanCore")
     .withArgs(unauthorized.address);
  });
});
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly.

- [ ] **Step 3: Commit Task 3 with Linear Magic Word**

```bash
git add test/HoloFiLendingPool.ts
git commit -m "test(HF-15): add TypeScript integration tests for HoloFiLendingPool (Fixes HF-15)"
```
