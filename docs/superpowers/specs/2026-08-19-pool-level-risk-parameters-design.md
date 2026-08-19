# Pool-Level Risk Parameters & Per-Vault LendingPool Binding Specification

- **Feature**: Move Credit Risk Parameters to `HoloFiLendingPool` & Bind `LendingPool` in `createVault`
- **Status**: Draft / Approved Design
- **Date**: 2026-08-19
- **Author**: HoloFi Team

---

## 1. Executive Summary & Objectives

This specification defines the architectural refactoring of the HoloFi lending protocol to decentralize credit risk parameters from a monolithic global configuration in `HoloFiVaultLoanCore` into individual, custom-tailored `HoloFiLendingPool` instances.

### Key Objectives:
1. **Per-Pool Risk Differentiation**: Allow each `HoloFiLendingPool` to define and customize its own 4 core risk parameters (`maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`).
2. **Explicit Vault-to-Pool Binding**: Require `createVault(address lendingPool)` so that each vault is strictly bound to one lending pool, eliminating multi-currency contamination.
3. **Simplified User Interface**: Streamline borrow and repayment signatures (`borrow(vaultId, amount)`, `repay(vaultId, amount)`) by eliminating redundant pool address parameters.

---

## 2. Detailed Technical Specification

### 2.1 Target Contracts & Components

| Contract | Key Changes |
| :--- | :--- |
| [`HoloFiLendingPool.sol`](file:///Users/gnepud/projects/holofi/holofi_protocol/contracts/HoloFiLendingPool.sol) | Store 4 risk parameters (`maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`), constructor initialization, and `setRiskParameters` admin function. |
| [`HoloFiLendingPoolFactory.sol`](file:///Users/gnepud/projects/holofi/holofi_protocol/contracts/HoloFiLendingPoolFactory.sol) | Update `createPool` signature to accept 4 risk parameters and initialize new pools with them. |
| [`HoloFiVaultLoanCore.sol`](file:///Users/gnepud/projects/holofi/holofi_protocol/contracts/HoloFiVaultLoanCore.sol) | Add `lendingPool` to `CollateralVault` struct. Update `createVault(address lendingPool)`. Remove global risk variables and read risk parameters dynamically from `vault.lendingPool`. Simplify `borrow(vaultId, amount)` and `repay(vaultId, amount)`. |
| [`HoloFiDutchAuction.sol`](file:///Users/gnepud/projects/holofi/holofi_protocol/contracts/HoloFiDutchAuction.sol) | In `startAuction`, `settleAuction`, and `treasuryBuyback`, dynamically read `liquidationPenaltyBps` and settle repayments to `vault.lendingPool`. |

---

### 2.2 Contract Modifications

#### A. `HoloFiLendingPool.sol`
```solidity
contract HoloFiLendingPool is ERC4626 {
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 public maxLtvBps;                // Max LTV (e.g. 5000 = 50.00%)
    uint256 public liquidationThresholdBps; // Liquidation Threshold (e.g. 7000 = 70.00%)
    uint256 public liquidationPenaltyBps;   // Liquidation Penalty (e.g. 1000 = 10.00%)
    uint256 public borrowRateBpsPerYear;      // Borrow Rate APY (e.g. 500 = 5.00%)

    event RiskParametersUpdated(
        uint256 maxLtvBps,
        uint256 liquidationThresholdBps,
        uint256 liquidationPenaltyBps,
        uint256 borrowRateBpsPerYear
    );

    error InvalidRiskParameters();

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address _acm,
        uint256 _maxLtvBps,
        uint256 _liquidationThresholdBps,
        uint256 _liquidationPenaltyBps,
        uint256 _borrowRateBpsPerYear
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        // Validation: maxLtvBps <= liquidationThresholdBps <= 10000
        if (_maxLtvBps > _liquidationThresholdBps || _liquidationThresholdBps > BPS_DENOMINATOR) {
            revert InvalidRiskParameters();
        }
        maxLtvBps = _maxLtvBps;
        liquidationThresholdBps = _liquidationThresholdBps;
        liquidationPenaltyBps = _liquidationPenaltyBps;
        borrowRateBpsPerYear = _borrowRateBpsPerYear;
    }

    function setRiskParameters(
        uint256 _maxLtvBps,
        uint256 _liquidationThresholdBps,
        uint256 _liquidationPenaltyBps,
        uint256 _borrowRateBpsPerYear
    ) external {
        if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedAdmin(msg.sender);
        }
        if (_maxLtvBps > _liquidationThresholdBps || _liquidationThresholdBps > BPS_DENOMINATOR) {
            revert InvalidRiskParameters();
        }
        maxLtvBps = _maxLtvBps;
        liquidationThresholdBps = _liquidationThresholdBps;
        liquidationPenaltyBps = _liquidationPenaltyBps;
        borrowRateBpsPerYear = _borrowRateBpsPerYear;
        emit RiskParametersUpdated(_maxLtvBps, _liquidationThresholdBps, _liquidationPenaltyBps, _borrowRateBpsPerYear);
    }
}
```

---

#### B. `HoloFiLendingPoolFactory.sol`
```solidity
function createPool(
    IERC20 asset,
    string calldata name,
    string calldata symbol,
    uint256 maxLtvBps,
    uint256 liquidationThresholdBps,
    uint256 liquidationPenaltyBps,
    uint256 borrowRateBpsPerYear
) external returns (address pool) {
    if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) revert UnauthorizedOperator(msg.sender);
    if (address(asset) == address(0)) revert ZeroAddressAsset();
    if (getPool[address(asset)] != address(0)) revert PoolAlreadyExists(address(asset), getPool[address(asset)]);

    HoloFiLendingPool poolContract = new HoloFiLendingPool(
        asset,
        name,
        symbol,
        address(acm),
        maxLtvBps,
        liquidationThresholdBps,
        liquidationPenaltyBps,
        borrowRateBpsPerYear
    );
    pool = address(poolContract);
    getPool[address(asset)] = pool;
    isValidPool[pool] = true;
    allPools.push(pool);

    emit PoolCreated(address(asset), pool, name, symbol);
}
```

---

#### C. `HoloFiVaultLoanCore.sol`
```solidity
struct CollateralVault {
    uint256 vaultId;
    address owner;
    address lendingPool;         // Pool bound during creation
    uint256[] tokenIds;
    uint256 principalDebt;
    uint256 accumulatedInterest;
    uint256 lastInterestUpdateTime;
    VaultStatus status;
}

event VaultCreated(uint256 indexed vaultId, address indexed owner, address indexed lendingPool);

function createVault(address lendingPool) external returns (uint256 vaultId) {
    if (!acm.isKybApproved(msg.sender)) revert KybRequired(msg.sender);
    if (!poolFactory.isValidPool(lendingPool)) revert UnregisteredLendingPool(lendingPool);

    vaultId = nextVaultId++;
    vaults[vaultId] = CollateralVault({
        vaultId: vaultId,
        owner: msg.sender,
        lendingPool: lendingPool,
        tokenIds: new uint256[](0),
        principalDebt: 0,
        accumulatedInterest: 0,
        lastInterestUpdateTime: block.timestamp,
        status: VaultStatus.Active
    });

    emit VaultCreated(vaultId, msg.sender, lendingPool);
}

function getMaxBorrowCapacity(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
    address pool = vaults[vaultId].lendingPool;
    uint256 maxLtvBps = HoloFiLendingPool(pool).maxLtvBps();
    return (vaultFmv * maxLtvBps) / BPS_DENOMINATOR;
}

function getHealthFactor(uint256 vaultId, uint256 vaultFmv) public view returns (uint256) {
    uint256 totalDebt = getTotalDebt(vaultId);
    if (totalDebt == 0) return type(uint256).max;
    address pool = vaults[vaultId].lendingPool;
    uint256 ltBps = HoloFiLendingPool(pool).liquidationThresholdBps();
    return (vaultFmv * ltBps * HEALTH_FACTOR_PRECISION) / (totalDebt * BPS_DENOMINATOR);
}

function accrueInterest(uint256 vaultId) public {
    CollateralVault storage vault = vaults[vaultId];
    uint256 dt = block.timestamp - vault.lastInterestUpdateTime;
    if (dt == 0) return;

    if (vault.principalDebt > 0) {
        uint256 borrowRate = HoloFiLendingPool(vault.lendingPool).borrowRateBpsPerYear();
        uint256 interestNew = (vault.principalDebt * borrowRate * dt) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        vault.accumulatedInterest += interestNew;
        emit InterestAccrued(vaultId, interestNew, vault.accumulatedInterest, block.timestamp);
    }
    vault.lastInterestUpdateTime = block.timestamp;
}

function borrow(uint256 vaultId, uint256 amount) external {
    CollateralVault storage vault = vaults[vaultId];
    if (msg.sender != vault.owner) revert UnauthorizedVaultOwner(vaultId, msg.sender);
    if (vault.status != VaultStatus.Active) revert VaultNotActive(vaultId);
    if (amount == 0) revert ZeroBorrowAmount();

    accrueInterest(vaultId);

    uint256 vaultFmv = getVaultFMV(vaultId);
    uint256 maxBorrow = getMaxBorrowCapacity(vaultId, vaultFmv);
    uint256 newTotalDebt = getTotalDebt(vaultId) + amount;

    if (newTotalDebt > maxBorrow) {
        revert ExceedsMaxBorrowCapacity(vaultId, newTotalDebt, maxBorrow);
    }

    vault.principalDebt += amount;
    HoloFiLendingPool(vault.lendingPool).drawLiquidity(vault.owner, amount);

    emit BorrowExecuted(vaultId, vault.owner, vault.lendingPool, amount, vault.principalDebt);
}

function repay(uint256 vaultId, uint256 amount) public {
    CollateralVault storage vault = vaults[vaultId];
    if (vault.status != VaultStatus.Active) revert VaultNotActive(vaultId);
    if (amount == 0) revert ZeroRepayAmount();

    accrueInterest(vaultId);

    uint256 totalDebt = vault.accumulatedInterest + vault.principalDebt;
    if (totalDebt == 0) revert NoActiveDebt(vaultId);

    uint256 actualRepay = amount > totalDebt ? totalDebt : amount;
    uint256 interestPaid;
    uint256 principalPaid;

    if (actualRepay <= vault.accumulatedInterest) {
        vault.accumulatedInterest -= actualRepay;
        interestPaid = actualRepay;
    } else {
        interestPaid = vault.accumulatedInterest;
        principalPaid = actualRepay - interestPaid;
        vault.accumulatedInterest = 0;
        vault.principalDebt -= principalPaid;
    }

    HoloFiLendingPool(vault.lendingPool).returnLiquidity(msg.sender, actualRepay);

    emit RepaymentExecuted(
        vaultId,
        msg.sender,
        vault.lendingPool,
        actualRepay,
        interestPaid,
        principalPaid,
        vault.principalDebt,
        vault.accumulatedInterest
    );
}

function repayAndWithdraw(
    uint256 vaultId,
    uint256 repayAmount,
    uint256[] calldata withdrawTokenIds
) external {
    if (withdrawTokenIds.length > 0 && vaults[vaultId].owner != msg.sender) {
        revert UnauthorizedVaultOwner(vaultId, msg.sender);
    }
    if (repayAmount > 0) {
        repay(vaultId, repayAmount);
    }
    if (withdrawTokenIds.length > 0) {
        withdrawCollateral(vaultId, withdrawTokenIds);
    }
}
```

---

#### D. `HoloFiDutchAuction.sol`
- `startAuction(uint256 vaultId)` reads `vault = loanCore.getVault(vaultId)`, reads `penaltyBps = HoloFiLendingPool(vault.lendingPool).liquidationPenaltyBps()`.
- `settleAuction(uint256 vaultId)` repays debt directly to `vault.lendingPool`.
- `treasuryBuyback(uint256 vaultId)` repays debt directly to `vault.lendingPool`.

---

## 3. Deployment & Migration Impact

1. **Hardhat Ignition Modules**:
   - `ignition/modules/DeployHoloFiLendingPool.ts` and `DeployHoloFiLendingPoolWithMock.ts`: pass risk parameters `[5000, 7000, 1000, 500]` to `createPool`.
2. **Scripts**:
   - Update `scripts/view-card.ts` (if reading vault info, `vault.lendingPool` is available).
3. **Tests**:
   - Update `test/HoloFiVaultLoanCore.ts`, `test/HoloFiLendingPool.ts`, `test/HoloFiLendingPoolFactory.ts`, `test/HoloFiDutchAuction.ts`, `test/DeployHoloFiProtocol.ts`.
   - Update Solidity unit tests: `contracts/HoloFiVaultLoanCore.t.sol`, `contracts/HoloFiLendingPool.t.sol`, `contracts/HoloFiLendingPoolFactory.t.sol`, `contracts/HoloFiDutchAuction.t.sol`.

---

## 4. Verification Plan

- Full compilation & typechecking: `npx hardhat build && npx tsc --noEmit`
- Full test suite passing: `npx hardhat test`
