# Open-Market Liquidation Engine Basic Setup (`HoloFiDutchAuction`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the contract shell for `HoloFiDutchAuction.sol` and the `dutchAuction` role authorization hooks in `HoloFiVaultLoanCore.sol` for HF-25.

**Architecture:** Create `HoloFiDutchAuction.sol` referencing `acm`, `loanCore`, and `poolFactory`. Add `dutchAuction` state variable, `DutchAuctionUpdated` event, custom liquidation errors, and `setDutchAuction` setter in `HoloFiVaultLoanCore.sol`. Verified via Solidity unit tests (`contracts/HoloFiDutchAuction.t.sol`).

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Basic Contract Setup & Role Authorization Hooks

**Files:**
- Create: `contracts/HoloFiDutchAuction.sol`
- Create: `contracts/HoloFiDutchAuction.t.sol`
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: `HoloFiDutchAuction` contract shell, `dutchAuction` state variable in `LoanCore`, `setDutchAuction` function.

- [ ] **Step 1: Write Solidity Unit Test Suite (`contracts/HoloFiDutchAuction.t.sol`)**

Create `contracts/HoloFiDutchAuction.t.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiDutchAuction } from "./HoloFiDutchAuction.sol";

contract HoloFiDutchAuctionTest is Test {
    AccessControlManager public acm;
    HoloFiCardCollection public cardCollection;
    HoloFiLendingPoolFactory public poolFactory;
    HoloFiVaultLoanCore public loanCore;
    HoloFiDutchAuction public dutchAuction;

    address public admin = address(0x1111);
    address public unauthorized = address(0x9999);

    function setUp() public {
        acm = new AccessControlManager(admin);
        cardCollection = new HoloFiCardCollection("HoloFi TCG Cards", "HFC", address(acm));
        poolFactory = new HoloFiLendingPoolFactory(address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(cardCollection), address(poolFactory));
        dutchAuction = new HoloFiDutchAuction(address(acm), address(loanCore), address(poolFactory));

        vm.prank(admin);
        loanCore.setDutchAuction(address(dutchAuction));
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(dutchAuction.acm()), address(acm));
        assertEq(address(dutchAuction.loanCore()), address(loanCore));
        assertEq(address(dutchAuction.poolFactory()), address(poolFactory));
        assertEq(loanCore.dutchAuction(), address(dutchAuction));
    }

    function test_RevertIf_Constructor_ZeroAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressACM.selector));
        new HoloFiDutchAuction(address(0), address(loanCore), address(poolFactory));

        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressLoanCore.selector));
        new HoloFiDutchAuction(address(acm), address(0), address(poolFactory));

        vm.expectRevert(abi.encodeWithSelector(HoloFiDutchAuction.ZeroAddressPoolFactory.selector));
        new HoloFiDutchAuction(address(acm), address(loanCore), address(0));
    }

    function test_SetDutchAuction_Success() public {
        vm.prank(admin);
        loanCore.setDutchAuction(address(0x1234));
        assertEq(loanCore.dutchAuction(), address(0x1234));
    }

    function test_RevertIf_SetDutchAuction_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnauthorizedAdmin.selector, unauthorized));
        loanCore.setDutchAuction(address(0x1234));
    }
}
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing `HoloFiDutchAuction.sol` and `setDutchAuction` in `HoloFiVaultLoanCore.sol`.

- [ ] **Step 3: Create `contracts/HoloFiDutchAuction.sol` Shell & Update `contracts/HoloFiVaultLoanCore.sol`**

Create `contracts/HoloFiDutchAuction.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

contract HoloFiDutchAuction {
    struct Auction {
        uint256 vaultId;
        uint256 startFmv;
        uint256 startPrice;
        uint256 reservePrice;
        uint256 startTime;
        uint256 duration;
        address seller;
        bool isSettled;
    }

    uint256 public constant DEFAULT_AUCTION_DURATION = 48 hours;

    AccessControlManager public immutable acm;
    HoloFiVaultLoanCore public immutable loanCore;
    HoloFiLendingPoolFactory public immutable poolFactory;

    mapping(uint256 => Auction) public auctions;

    event AuctionStarted(
        uint256 indexed vaultId,
        uint256 startPrice,
        uint256 reservePrice,
        uint256 startTime,
        uint256 duration
    );

    event AuctionSettled(
        uint256 indexed vaultId,
        address indexed liquidator,
        address indexed lendingPool,
        uint256 finalPrice,
        uint256 debtPaid,
        uint256 surplusToSeller
    );

    error ZeroAddressACM();
    error ZeroAddressLoanCore();
    error ZeroAddressPoolFactory();
    error AuctionAlreadyStarted(uint256 vaultId);
    error AuctionNotActive(uint256 vaultId);
    error UnregisteredLendingPool(address pool);

    constructor(address _acm, address _loanCore, address _poolFactory) {
        if (_acm == address(0)) revert ZeroAddressACM();
        if (_loanCore == address(0)) revert ZeroAddressLoanCore();
        if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();

        acm = AccessControlManager(_acm);
        loanCore = HoloFiVaultLoanCore(_loanCore);
        poolFactory = HoloFiLendingPoolFactory(_poolFactory);
    }
}
```

Update `contracts/HoloFiVaultLoanCore.sol` to add state, errors, events, and `setDutchAuction`:

```solidity
address public dutchAuction;

error UnauthorizedAuction(address caller);
error VaultNotEligibleForLiquidation(uint256 vaultId, uint256 healthFactor);
error VaultNotLiquidating(uint256 vaultId);

event DutchAuctionUpdated(address indexed newAuction);
event VaultLiquidationStarted(uint256 indexed vaultId);
event VaultLiquidated(uint256 indexed vaultId, address indexed liquidator);

function setDutchAuction(address _dutchAuction) external {
    if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
        revert UnauthorizedAdmin(msg.sender);
    }
    dutchAuction = _dutchAuction;
    emit DutchAuctionUpdated(_dutchAuction);
}
```

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (89 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1 with Linear Magic Word**

```bash
git add contracts/HoloFiDutchAuction.sol contracts/HoloFiDutchAuction.t.sol contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-25): implement HoloFiDutchAuction contract shell and setDutchAuction hook (Fixes HF-25)"
```
