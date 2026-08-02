# LendingPool Registry & Verification Guard (`HoloFiLendingPoolFactory` & `HoloFiVaultLoanCore`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement pool validity mapping in `HoloFiLendingPoolFactory.sol` and enforce an immutable `poolFactory` security check inside `borrow()` and `repay()` in `HoloFiVaultLoanCore.sol` to block fake or unapproved lending pools.

**Architecture:** Extend `HoloFiLendingPoolFactory.sol` with `mapping(address => bool) public isValidPool;`. Update `HoloFiVaultLoanCore.sol` to accept `address _poolFactory` in its constructor and store `poolFactory = HoloFiLendingPoolFactory(_poolFactory)`. Enforce `if (!poolFactory.isValidPool(lendingPool)) revert UnregisteredLendingPool(lendingPool);` at the top of `borrow()` and `repay()`. Update all contract deployments across test suites.

**Tech Stack:** Solidity ^0.8.28, OpenZeppelin `@openzeppelin/contracts`, Hardhat 3, Ethers v6, `forge-std`, Mocha, Chai.

## Global Constraints

- Use Solidity version `^0.8.28`
- Follow Hardhat 3 ESM standards and `network.create()` API for TypeScript tests
- If the commit relates to any Linear issue → Must use closing magic words for closing commits or non-closing magic words for non-closing commits.
- Always run `npx hardhat build && npx tsc --noEmit && npx hardhat test` for verification before completing any task

---

### Task 1: Implement Pool Verification Guard in Contracts & Update Solidity Unit Tests

**Files:**
- Modify: `contracts/HoloFiLendingPoolFactory.sol`
- Modify: `contracts/HoloFiLendingPoolFactory.t.sol`
- Modify: `contracts/HoloFiVaultLoanCore.sol`
- Modify: `contracts/HoloFiVaultLoanCore.t.sol`

**Interfaces:**
- Produces: `isValidPool` mapping on factory, `poolFactory` immutable reference on `LoanCore`, `UnregisteredLendingPool` revert.

- [ ] **Step 1: Write Solidity Unit Test Additions**

Add unit tests to `contracts/HoloFiLendingPoolFactory.t.sol`:

```solidity
    function test_CreatePool_SetsIsValidPool() public {
        vm.prank(admin);
        address pool = factory.createPool(asset, "Pool EURC", "pEURC");

        assertTrue(factory.isValidPool(pool));
    }

    function test_IsValidPool_UnregisteredPool() public view {
        assertFalse(factory.isValidPool(address(0x9999)));
    }
```

Add unit tests and update `setUp()` in `contracts/HoloFiVaultLoanCore.t.sol`:

```solidity
    HoloFiLendingPoolFactory public poolFactory;

    // In setUp():
    poolFactory = new HoloFiLendingPoolFactory(address(acm));
    loanCore = new HoloFiVaultLoanCore(address(acm), address(cardCollection), address(poolFactory));

    function test_RevertIf_Constructor_ZeroAddressPoolFactory() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressPoolFactory.selector));
        new HoloFiVaultLoanCore(address(acm), address(cardCollection), address(0));
    }

    function test_RevertIf_Borrow_UnregisteredLendingPool() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnregisteredLendingPool.selector, address(0x9999)));
        loanCore.borrow(vaultId, 1000 * 1e6, address(0x9999));
    }

    function test_RevertIf_Repay_UnregisteredLendingPool() public {
        vm.prank(store);
        uint256 vaultId = loanCore.createVault();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.UnregisteredLendingPool.selector, address(0x9999)));
        loanCore.repay(vaultId, 1000 * 1e6, address(0x9999));
    }
```

- [ ] **Step 2: Run Solidity tests to verify failure before implementation**

Run: `npx hardhat test solidity`
Expected: FAIL due to missing constructor parameter and `isValidPool` guard.

- [ ] **Step 3: Update `contracts/HoloFiLendingPoolFactory.sol` and `contracts/HoloFiVaultLoanCore.sol` Implementation**

Update `contracts/HoloFiLendingPoolFactory.sol`:

```solidity
    mapping(address => bool) public isValidPool;

    function createPool(
        IERC20 asset,
        string calldata name,
        string calldata symbol
    ) external returns (address pool) {
        ...
        HoloFiLendingPool poolContract = new HoloFiLendingPool(asset, name, symbol, address(acm));
        pool = address(poolContract);

        getPool[address(asset)] = pool;
        isValidPool[pool] = true;
        allPools.push(pool);
        ...
    }
```

Update `contracts/HoloFiVaultLoanCore.sol`:

```solidity
import { HoloFiLendingPoolFactory } from "./HoloFiLendingPoolFactory.sol";

HoloFiLendingPoolFactory public immutable poolFactory;

error ZeroAddressPoolFactory();
error UnregisteredLendingPool(address pool);

constructor(address _acm, address _nftCollection, address _poolFactory) {
    if (_acm == address(0)) revert ZeroAddressACM();
    if (_nftCollection == address(0)) revert ZeroAddressNFT();
    if (_poolFactory == address(0)) revert ZeroAddressPoolFactory();

    acm = AccessControlManager(_acm);
    nftCollection = HoloFiCardCollection(_nftCollection);
    poolFactory = HoloFiLendingPoolFactory(_poolFactory);
}

function borrow(uint256 vaultId, uint256 amount, address lendingPool) external {
    if (!poolFactory.isValidPool(lendingPool)) {
        revert UnregisteredLendingPool(lendingPool);
    }
    ...
}

function repay(uint256 vaultId, uint256 amount, address lendingPool) external {
    if (!poolFactory.isValidPool(lendingPool)) {
        revert UnregisteredLendingPool(lendingPool);
    }
    ...
}
```

Note: Update pool creation in `test_Borrow_Success`, `test_Repay_PartialInterestAndPrincipal`, and other `HoloFiVaultLoanCore.t.sol` test cases to use `poolFactory.createPool(asset, "Pool EURC", "pEURC")` (or mock pool registration if needed).

- [ ] **Step 4: Run Solidity unit tests to verify pass**

Run: `npx hardhat test solidity`
Expected: PASS cleanly (81 total Solidity unit tests).

- [ ] **Step 5: Commit Task 1**

```bash
git add contracts/HoloFiLendingPoolFactory.sol contracts/HoloFiLendingPoolFactory.t.sol contracts/HoloFiVaultLoanCore.sol contracts/HoloFiVaultLoanCore.t.sol
git commit -m "feat(HF-32): implement pool registry mapping and loan core verification guard (relates to HF-32)"
```

---

### Task 2: Implement TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts` & `test/HoloFiLendingPoolFactory.ts`)

**Files:**
- Modify: `test/HoloFiVaultLoanCore.ts`
- Modify: `test/HoloFiLendingPoolFactory.ts`

**Interfaces:**
- Consumes: `isValidPool`, `UnregisteredLendingPool`.

- [ ] **Step 1: Update `test/HoloFiVaultLoanCore.ts` & `test/HoloFiLendingPoolFactory.ts`**

Update `deployLoanCoreFixture` in `test/HoloFiVaultLoanCore.ts`:

```ts
    const poolFactory = await ethers.deployContract("HoloFiLendingPoolFactory", [await acm.getAddress()]);
    const loanCore = await ethers.deployContract("HoloFiVaultLoanCore", [
      await acm.getAddress(),
      await cardCollection.getAddress(),
      await poolFactory.getAddress(),
    ]);
```

Add integration test for unregistered pool revert:

```ts
  it("Should revert borrow or repay with UnregisteredLendingPool for unapproved pool address", async function () {
    const { loanCore, store, unauthorized } = await networkHelpers.loadFixture(deployLoanCoreFixture);

    await loanCore.connect(store).createVault();

    await expect(
      loanCore.connect(store).borrow(1n, 1000n, unauthorized.address)
    ).to.be.revertedWithCustomError(loanCore, "UnregisteredLendingPool")
     .withArgs(unauthorized.address);

    await expect(
      loanCore.connect(store).repay(1n, 1000n, unauthorized.address)
    ).to.be.revertedWithCustomError(loanCore, "UnregisteredLendingPool")
     .withArgs(unauthorized.address);
  });
```

Update pool deployments in `test/HoloFiVaultLoanCore.ts` to deploy pools through `poolFactory.connect(admin).createPool(...)` (or `getPool` lookup).

Add test to `test/HoloFiLendingPoolFactory.ts`:

```ts
    it("Should set isValidPool to true when pool is created", async function () {
      const { factory, eurc } = await networkHelpers.loadFixture(deployFactoryFixture);
      await factory.createPool(await eurc.getAddress(), "HoloFi Pool EURC", "pEURC");
      const poolAddr = await factory.getPool(await eurc.getAddress());
      expect(await factory.isValidPool(poolAddr)).to.be.true;
    });
```

- [ ] **Step 2: Run build, typecheck, and full test suite**

Run: `npx hardhat build && npx tsc --noEmit && npx hardhat test`
Expected: PASS cleanly (111 total tests: 81 Solidity + 30 TypeScript/Mocha).

- [ ] **Step 3: Commit Task 2 with Linear Magic Word**

```bash
git add test/HoloFiVaultLoanCore.ts test/HoloFiLendingPoolFactory.ts
git commit -m "test(HF-32): add TypeScript integration tests for lending pool registry guard (Fixes HF-32)"
```
