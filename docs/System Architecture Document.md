# HoloFi Protocol V1

## 1. System Vision & Architectural Decoupling

**HoloFi** is an on-chain B2B Real-World Asset (RWA) financing infrastructure designed for Trading Card Game (TCG: Pokémon, Magic: The Gathering, Yu-Gi-Oh!) stores and merchants. The system enforces a strict separation of concerns between physical custody and the on-chain credit engine:

1. **Physical Logistics & Vaulting**: 100% delegated to certified partner **Blink**, which handles physical card reception, grading authentication, secure vaulting, and physical delivery upon redemption.


2. **On-Chain Register & Credit Engine**: Powered by smart contracts on EVM-compatible blockchains. HoloFi manages a single, permissioned NFT collection (`HoloFiVaultCard`), store-isolated collateral vaults (`CollateralVault`), a shared liquidity pool (`ERC-4626`), an oracle valuation pipeline (`Chainlink CRE` + `FMV Engine`), and a Dutch Auction liquidation mechanism.



---

## 2. Global Architecture & Component Diagram

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       OFF-CHAIN SERVICES LAYER                                         │
│                                                                                                        │
│  ┌─────────────────────────┐     ┌────────────────────────────────┐     ┌──────────────────────────┐   │
│  │     Blink Partner       │     │     FMV Analytics Engine       │     │  Chainlink CRE Node      │   │
│  │ (Physical Vault & Spec) │     │ (Filtering, Outliers, TWAP90)  │     │ (EIP-712 Signed Payload) │   │
│  └────────────┬────────────┘     └───────────────┬────────────────┘     └────────────┬─────────────┘   │
└───────────────┼──────────────────────────────────┼───────────────────────────────────┼─────────────────┘
                │ Physical Attestation             │ Cleaned Prices                    │ Signed Payload
                ▼                                  ▼                                   ▼
──────────────────────────────────────────────────────────────────────────────────────────────────────────
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ON-CHAIN SMART CONTRACTS LAYER                                       │
│                                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 AccessControlManager (KYB & Roles)                               │  │
│  └────────────┬──────────────────────────────────┬───────────────────────────────────┬──────────────┘  │
│               │                                  │                                   │                 │
│               ▼                                  ▼                                   ▼                 │
│  ┌────────────────────────┐         ┌─────────────────────────┐         ┌──────────────────────────┐   │
│  │     HoloFiVaultCard    │         │   HoloFiVaultLoanCore   │         │  HoloFiLendingPool       │   │
│  │ (Single Global Coll.)  │◄───────►│   (Collateral Vaults)   │◄───────►│ (Generic ERC-4626 Pool)  │   │
│  └────────────────────────┘         └────────────┬────────────┘         └────────────▲─────────────┘   │
│                                                  │                                   │ Deploys Pools   │
│                                                  │ Trigger Liquidation  ┌────────────┴─────────────┐   │
│                                                  ▼                      │ HoloFiLendingPoolFactory │   │
│                                     ┌─────────────────────────┐         │  (Multi-Asset Factory)   │   │
│                                     │  HoloFiDutchAuction     │         └──────────────────────────┘   │
│                                     │  (Vault Liquidation)    │                                        │
│                                     └─────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘

```

---

## 3. Detailed Technical Module Specifications

### 3.1. Unified Ownership Registry: `HoloFiVaultCard`

All vaulted TCG cards across all stores are minted within a **single, unified ERC-721 Collection** (`HoloFi Vaulted TCG Collection`).

* **Transfer Restrictions (Permissioned ERC-721)**:
Retain standard OpenZeppelin ERC-721 transfer logic so NFTs transfer freely between standard wallets outside of loans, but disallow transfers if the NFT is locked under collateral staking (`isLocked == true`). Attempting to transfer a locked card reverts with `CardIsLocked(tokenId)`.


* **On-Chain Data Model**:
```solidity
struct CardMetadata {
    uint256 tokenId;
    bytes32 attestationHash; // keccak256 hash of Blink metadata (Grader, Cert #, Grade)
    uint256 mintTimestamp;
    bool isLocked;           // True if committed inside a Collateral Vault
}
mapping(uint256 => CardMetadata) public cards;

```



---

### 3.2. Valuation Engine & Oracle Pipeline: FMV Module & Chainlink CRE

#### A. Fair Market Value (FMV) Calculation Algorithm

The off-chain FMV module processes 30-to-90-day sales history across public marketplaces (Cardmarket, eBay, TCGplayer) via a 3-step pipeline:

1. **Outlier Filtering (IQR Method)**:

$$Q_1 = \text{1st Quartile}, \quad Q_3 = \text{3rd Quartile}, \quad \text{IQR} = Q_3 - Q_1$$



Transactions with prices $P_i \notin [Q_1 - 1.5 \times \text{IQR}, \; Q_3 + 1.5 \times \text{IQR}]$ are discarded.
2. **Volume-Weighted 90-Day TWAP (VW-TWAP)**:

$$\text{TWAP}_{90d} = \frac{\sum_{i=1}^{n} (P_i \times V_i \times w_i)}{\sum_{i=1}^{n} (V_i \times w_i)}$$



where $V_i$ is trade volume and $w_i = e^{-\lambda (t_{\text{current}} - t_i)}$ is time decay.
3. **Confidence Score Haircut**:
If total transaction count $n < N_{\text{min}}$ within the 90-day window:

$$\text{FMV}_{\text{final}} = \text{TWAP}_{90d} \times \left(1 - \min\left(\text{Haircut}_{\text{max}}, \; \gamma \cdot \frac{N_{\text{min}} - n}{N_{\text{min}}}\right)\right)$$



#### B. Chainlink CRE Architecture & EIP-712 Signatures

The **Chainlink Runtime Environment (CRE)** node executes the aggregation script and cryptographically signs the output.

* **EIP-712 Typed Data Structure**:
```solidity
bytes32 public constant VAULT_VALUATION_TYPEHASH = keccak256(
    "VaultValuationPayload(uint256 vaultId,uint256 totalFmv,uint256 timestamp,uint256 expiration,uint256 nonce)"
);

struct VaultValuationPayload {
    uint256 vaultId;
    uint256 totalFmv;    // Aggregated vault FMV in USDC (6 decimals)
    uint256 timestamp;
    uint256 expiration;  // E.g., timestamp + 2 hours
    uint256 nonce;
}

```


* **On-Chain Verification**:
During `borrow()`, `withdrawCollateral()`, or `triggerVaultLiquidation()`, the contract reconstructs the digest via `_hashTypedDataV4` and verifies `ECDSA.recover`. Transactions revert if:
1. The signature is not from an authorized `ORACLE_ROLE` address.
2. `block.timestamp > payload.expiration`.
3. The `nonce` has already been spent.



---

### 3.3. Credit Manager: `HoloFiVaultLoanCore`

Manages isolated `CollateralVault` accounting for each store.

#### A. Core Data Structures & State Mappings

```solidity
enum VaultStatus { Active, Liquidating, Closed }

struct CollateralVault {
    uint256 vaultId;
    address owner;                  // Store wallet address
    uint256[] tokenIds;             // List of deposited NFT token IDs (from global collection)
    uint256 principalDebt;          // Borrowed capital
    uint256 accumulatedInterest;    // Unpaid accrued interest
    uint256 lastInterestUpdateTime;     // Timestamp of last interest calculation
    VaultStatus status;
}

AccessControlManager public immutable acm;
HoloFiVaultCard public immutable vaultCard;
HoloFiLendingPoolFactory public immutable poolFactory;

mapping(uint256 => CollateralVault) public vaults;
mapping(uint256 => uint256) public nftVaultId; // Fast lookup mapping (tokenId => vaultId)
uint256 public nextVaultId = 1;
uint256 public maxLtvBps = 5000;                // Max LTV: 50.00%
uint256 public liquidationThresholdBps = 7000; // Liquidation Threshold: 70.00%
uint256 public liquidationPenaltyBps = 1000;   // Liquidation Penalty: 10.00%
uint256 public borrowRateBpsPerYear = 500;      // Borrow Rate: 5.00% APY
```

#### B. KYB Control & Escrow Mechanics

* **Vault Creation (`createVault`)**:
  - Restricted to KYB-approved store wallets (`acm.isKybApproved(msg.sender)`). Reverts with `KybRequired(msg.sender)` if unapproved.
  - Assigns unique `vaultId = nextVaultId++` and sets `status = VaultStatus.Active`.

* **Escrow Deposit (`depositCollateral`)**:
  - Stores can add card NFTs to their active vault at any time.
  - Executes `vaultCard.safeTransferFrom(msg.sender, address(this), tokenId)` and locks cards via `vaultCard.setCardLock(tokenId, true)` to prevent secondary transfers.
  - Registers `nftVaultId[tokenId] = vaultId` and pushes `tokenId` to `vault.tokenIds`.

* **LTV-Guarded Escrow Withdrawal (`withdrawCollateral`)**:
  - Stores can withdraw specific card NFTs from their vault.
  - **Interest Accrual Guard**: Triggers `accrueInterest(vaultId)` **first**.
  - **Zero Debt vs Active Debt LTV Check**:
    - If total debt is 0 (`currentTotalDebt == 0`): Allows withdrawing any or all requested `tokenIds`.
    - If active debt exists (`currentTotalDebt > 0`): Computes remaining collateral value `remainingFmv` after removing `tokenIds`. Verifies `currentTotalDebt <= getMaxBorrowCapacity(remainingFmv)`. Reverts with `InsufficientCollateralRatio` if the remaining collateral breaches safety thresholds.
  - Unlocks cards via `vaultCard.setCardLock(tokenId, false)` and returns NFTs via `vaultCard.safeTransferFrom(address(this), vault.owner, tokenId)`.
  - Clears `nftVaultId[tokenId]` and removes token from `vault.tokenIds`.

#### C. Risk Engine & Accounting Mechanics

* **Configurable Risk Parameters (`setRiskParameters`)**:
  - Restricted to `ADMIN_ROLE`. Configures `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, and `borrowRateBpsPerYear`. Reverts `InvalidRiskParameters()` if `maxLtvBps > liquidationThresholdBps`.

* **Continuous Interest Accrual (`accrueInterest`)**:

$$\Delta t = \text{block.timestamp} - \text{lastInterestUpdateTime}$$


$$\text{Interest}_{\text{new}} = \frac{\text{principalDebt} \times \text{borrowRateBpsPerYear} \times \Delta t}{10000 \times 365\text{ days}}$$


$$\text{accumulatedInterest} \leftarrow \text{accumulatedInterest} + \text{Interest}_{\text{new}}$$


* **Health Factor Engine (`calculateHealthFactor` / `getHealthFactor`)**:
  - Calculates Health Factor scaled with `1e18` precision:

$$HF = \frac{\text{Vault FMV} \times \text{liquidationThresholdBps} \times 1\text{e}18}{\text{Total Debt} \times 10000}$$

  - Returns `type(uint256).max` if total debt is 0.

* **Max Borrow Capacity (`getMaxBorrowCapacity`)**:

$$\text{MaxBorrow} = \text{Vault FMV} \times \frac{\text{maxLtvBps}}{10000}$$


#### D. Oracle Valuation, Pool Guard & Debt Settlement Mechanics

```solidity
mapping(uint256 => uint256) public cardFmv; // Fast lookup mapping (tokenId => FMV)
```

* **Oracle Valuation Updates (`setCardFmv` / `setBatchCardFmv`)**:
  - Restricted to `ORACLE_ROLE` or `ADMIN_ROLE`. Reverts `UnauthorizedOracle` if unauthorized.
  - Emits `CardFmvUpdated(tokenId, fmv)` for each card price update.

* **Vault Valuation Aggregation (`getVaultFMV`)**:
  - Computes total collateral value by summing `cardFmv[tokenId]` across all deposited cards in `vaults[vaultId].tokenIds`.

* **Credit Borrow Execution (`borrow`)**:
  - **Pool Security Guard**: Verifies `poolFactory.isValidPool(lendingPool)`. Reverts `UnregisteredLendingPool(lendingPool)` if pool is not registered in factory.
  - Restricted to vault owner (`msg.sender == vault.owner`). Reverts `UnauthorizedVaultOwner` if unauthorized.
  - Requires active vault status (`VaultNotActive`) and non-zero borrow amount (`ZeroBorrowAmount`).
  - **Interest Accrual Guard**: Triggers `accrueInterest(vaultId)` **first** prior to state updates.
  - **LTV Capacity Check**: Verifies `getTotalDebt(vaultId) + amount <= getMaxBorrowCapacity(getVaultFMV(vaultId))`. Reverts with `ExceedsMaxBorrowCapacity` if requested debt exceeds max LTV limit.
  - Increases `vault.principalDebt += amount`.
  - Executes `HoloFiLendingPool(lendingPool).drawLiquidity(vault.owner, amount)` to transfer underlying asset liquidity to store.
  - Emits `BorrowExecuted(vaultId, vault.owner, lendingPool, amount, vault.principalDebt)`.

* **Debt Repayment (`repay`)**:
  - **Pool Security Guard**: Verifies `poolFactory.isValidPool(lendingPool)`. Reverts `UnregisteredLendingPool(lendingPool)` if pool is not registered in factory.
  - Requires active vault status (`VaultNotActive`), non-zero amount (`ZeroRepayAmount`), and active debt (`NoActiveDebt`).
  - **Interest Accrual Guard**: Triggers `accrueInterest(vaultId)` **first**.
  - **Waterfall Allocation**: Pays off `accumulatedInterest` first, then reduces `principalDebt`. Caps repayment at total active debt.
  - Calls `HoloFiLendingPool(lendingPool).returnLiquidity(msg.sender, actualRepay)` to transfer funds from payer into lending pool.
  - Emits `RepaymentExecuted(vaultId, msg.sender, lendingPool, actualRepay, interestPaid, principalPaid, vault.principalDebt, vault.accumulatedInterest)`.

* **Atomic Repay & Withdraw (`repayAndWithdraw`)**:
  - Allows stores to pay down debt and release specific card NFTs in a single transaction.
  - **Authorization Guard**: Explicitly verifies `vaults[vaultId].owner == msg.sender` if `withdrawTokenIds.length > 0` before executing repayment or withdrawal.
  - Atomically calls `repay(vaultId, repayAmount, lendingPool)` and `withdrawCollateral(vaultId, withdrawTokenIds)`.

---

### 3.4. Multi-Asset Pool Factory & Liquidity Pools: `HoloFiLendingPoolFactory` & `HoloFiLendingPool`

* **Factory Registry & Pool Verification (`HoloFiLendingPoolFactory`)**:
  - Maintains `mapping(address => address) public getPool` and `mapping(address => bool) public isValidPool`.
  - Admin/Oracle deploys permissioned `HoloFiLendingPool` instances per ERC-20 asset via `createPool()`.
  - Automatically marks `isValidPool[pool] = true` upon instantiation for protocol security verification.

* **Illiquidity Gate**:
  If available free liquidity in the pool is insufficient during a borrow request (`IERC20(asset).balanceOf(address(this)) < amount`):

$$\text{Asset}_{\text{available}} = \text{Balance}_{\text{Asset}}$$

  The contract throws custom error `InsufficientVaultLiquidity(available, required)` and reverts the transaction.

* **Multi-Asset Pool Factory (`HoloFiLendingPoolFactory`)**:
  - Centralized factory for deploying and registering permissioned `HoloFiLendingPool` instances.
  - Pool deployment via `createPool(IERC20 asset, string calldata name, string calldata symbol)` is restricted to `ADMIN_ROLE` in `AccessControlManager`.
  - Maintains an on-chain lookup mapping `mapping(address => address) public getPool` (`underlyingAsset => poolAddress`) and array `address[] public allPools`.
  - Prevents duplicate pool creation per underlying asset, reverting with `PoolAlreadyExists(underlyingAsset, existingPool)`.



---

### 3.5. Liquidation Engine: `HoloFiDutchAuction`

Activated when a store vault's Health Factor ($HF$) falls below 1.0:

$$HF = \frac{\text{Vault FMV} \times \text{liquidationThresholdBps}}{\text{Total Debt} \times 10000} < 1.0$$

#### A. Dutch Auction Initiation & Parameters (`startAuction`)

1. **State Locking**: Calling `startAuction(vaultId)` verifies $HF < 1.0$, triggers `loanCore.startLiquidation(vaultId)`, and updates the target vault to `Liquidating` status. The store cannot borrow, repay, or withdraw assets while liquidating.

2. **Linear Price Decay Function (`getAuctionPrice`)**:
* **Start Price ($P_{\text{start}}$)**: $\text{Vault FMV} \times \frac{12000}{10000}$ (120.00% of Vault FMV)
* **Reserve Price ($P_{\text{reserve}}$)**: Total Debt ($\text{principalDebt} + \text{accumulatedInterest}$)
* **Default Auction Duration ($T_{\text{auction}}$)**: 48 hours.

$$\text{CurrentPrice}(t) = P_{\text{start}} - \left( (P_{\text{start}} - P_{\text{reserve}}) \times \frac{t - t_{\text{start}}}{48\text{ hours}} \right)$$

#### B. Auction Settlement & Fund Distribution (`settleAuction`)

When a liquidator calls `settleAuction(vaultId, lendingPool)` paying $\text{CurrentPrice}(t)$ in underlying asset tokens:

```text
Liquidator Buyer
    │
    │ 1. Pays CurrentPrice(t) in ERC-20 Asset
    ▼
HoloFiDutchAuction Contract
    │
    ├───► 2. Transfer Debt Amount (returnLiquidity) ──► HoloFiLendingPool (Generic ERC-4626)
    │                                                   (Full Principal + Interest Clearance)
    │
    ├───► 3. Transfer Surplus (If any) ───────────────► Original Store (Vault Owner)
    │
    └───► 4. finalizeLiquidation ─────────────────────► HoloFiVaultLoanCore
                                                        │
                                                        └─► Unlock & Transfer NFTs ──► Liquidator Address
                                                             (Emit AuctionSettled & VaultLiquidated)
```

#### C. Protocol Treasury Buyback (`treasuryBuyback`)

For auctions that expire after the 48-hour duration without receiving public bids, the authorized Protocol Treasury wallet (`treasury`) can execute a backstop buyback:

1. **Role & Expiration Validation**: Enforces `msg.sender == treasury` (`UnauthorizedTreasury`) and `block.timestamp >= auction.startTime + 48 hours` (`AuctionNotExpired`).
2. **Debt-Only Settlement**: The Treasury pays exactly 100% of the loan debt (`debtAmount`) into `HoloFiLendingPool` via `returnLiquidity(address(this), debtAmount)`. The 10% penalty fee is waived for Treasury to maximize capital efficiency.
3. **Physical Collateral Assignment**: Calls `loanCore.finalizeLiquidation(vaultId, msg.sender)` to assign the physical card NFT(s) directly to the Protocol Treasury wallet for off-chain liquidation.

---

## 4. Sequence Diagrams

### 4.1. Store Borrow Sequence

```text
Store               Front-End / CRE           LoanCore Contract       ERC-4626 Vault
   │                       │                          │                      │
   │─── 1. Select NFTs ───►│                          │                      │
   │    & Request Borrow   │                          │                      │
   │                       │─── 2. Fetch FMV Data ───►│                      │
   │                       │    & Generate EIP-712    │                      │
   │                       │    Signature             │                      │
   │                       │                          │                      │
   │◄── 3. Return Payload ─│                          │                      │
   │    & Signature        │                          │                      │
   │                       │                          │                      │
   │─── 4. borrow(vaultId, amount, payload, sig) ────►│                      │
   │                                                  │── 5. Verify EIP-712 ─│
   │                                                  │   & Check MaxBorrow  │
   │                                                  │                      │
   │                                                  │── 6. Transfer USDC ─►│
   │                                                  │   Request            │
   │                                                  │                      │
   │◄───────────────── 7. Transfer USDC ──────────────┼──────────────────────│

```

---

### 4.2. Dutch Auction Liquidation Sequence

```text
Keeper / Liquidator        DutchAuction Contract       LoanCore Contract       Blink Logistics
        │                            │                         │                      │
        │── 1. triggerLiquidation ──►│                         │                      │
        │   (with Signed Payload)    │── 2. Check HF < 1.0 ───►│                      │
        │                            │   Lock Vault Status     │                      │
        │                            │◄── 3. Transfer NFTs ────│                      │
        │                            │                         │                      │
        │── 4. bidAuction(vaultId) ─►│                         │                      │
        │   (Pay CurrentPrice USDC)  │── 5. Repay Debt ───────►│──► Repay ERC-4626    │
        │                            │── 6. Pay Surplus ──────►│──► Transfer Owner    │
        │                            │                         │                      │
        │◄── 7. Transfer NFTs ───────│                         │                      │
        │                            │                                                │
        │                            └────── 8. Emit Event AuctionSettled ───────────►│
        │                                                                             │
        │◄────────────────── 9. Physical Card Delivery (Off-Chain) ───────────────────│

```

---

## 5. Security & Access Control Matrix

### 5.1. OpenZeppelin AccessControl Roles

* `DEFAULT_ADMIN_ROLE`: Controlled by a 3-of-5 Multi-Sig. Governs upgrades and role assignments.
* `ORACLE_ROLE`: Granted exclusively to the **Chainlink CRE** node private key. Authorized to sign EIP-712 payloads.
* `PAUSER_ROLE`: Emergency pause capability (Circuit Breaker) over contract operations during market anomalies or security incidents.
* `KYB_MANAGER_ROLE`: Authorized to grant or revoke KYB whitelisted status for stores and LPs.

### 5.2. Smart Contract Mitigations

1. **Reentrancy Protection**: Strict enforcement of *Checks-Effects-Interactions* (CEI) pattern and mandatory `nonReentrant` modifiers on all token-transferring entry points (`borrow`, `repay`, `withdrawCollateral`, `bidAuction`).
2. **Replay Attack Protection**: Mandatory inclusion of `chainId`, `verifyingContract`, incremental `nonce`, and expiration timestamps within the EIP-712 domain struct.
3. **ERC-4626 Inflation Attack Protection**: Leverages OpenZeppelin’s virtual shares implementation (offset) to neutralize donation-based exchange-rate manipulation attacks.
