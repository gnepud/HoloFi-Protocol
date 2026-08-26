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
    bytes32 cardTypeId;      // Card type identifier (e.g. keccak256 hash of name/set/grade)
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



#### B. On-Chain Price Feed Architecture (`HoloFiCardPriceFeed`)

The **HoloFiCardPriceFeed** smart contract maintains an on-chain, gas-optimized Fair Market Value (FMV) price registry:

* **Packed Storage Structure**:
  - `PriceData` packs a 128-bit price (`uint128`, 18 decimals in USD) and a 128-bit timestamp (`uint128 lastUpdated`) into a single 256-bit EVM storage slot per `cardTypeId`.
* **Enumerable Card Types**:
  - Utilizes OpenZeppelin's `EnumerableSet.Bytes32Set` (`_cardTypeIds`) to dynamically register, track, and enumerate all supported TCG card types without duplicates.
* **Oracle Updates**:
  - Authorized `ORACLE_ROLE` accounts update prices via `setPrice(bytes32 cardTypeId, uint128 price)` or `setBatchPrices(bytes32[] cardTypeIds, uint128[] prices)`.
  - Emits `PriceUpdated(cardTypeId, price, timestamp)` events.
* **Synchronous On-Chain Consumption**:
  - `HoloFiVaultLoanCore` directly and synchronously queries `priceFeed.getPrice(cardTypeId)` during `borrow()`, `withdrawCollateral()`, and `startLiquidation()`, with normalization to target token decimals performed via `DecimalMath`.



---

### 3.3. Credit Manager: `HoloFiVaultLoanCore`

Manages isolated `CollateralVault` accounting for each store.

#### A. Core Data Structures & State Mappings

```solidity
enum VaultStatus { Active, Liquidating, Closed }

struct CollateralVault {
    uint256 vaultId;
    address owner;                  // Store wallet address
    address lendingPool;            // Pool bound during vault creation
    uint256[] tokenIds;             // List of deposited NFT token IDs (from global collection)
    uint256 principalDebt;          // Borrowed capital
    uint256 accumulatedInterest;    // Unpaid accrued interest
    uint256 lastInterestUpdateTime; // Timestamp of last interest calculation
    VaultStatus status;
}

AccessControlManager public immutable acm;
HoloFiVaultCard public immutable vaultCard;
HoloFiLendingPoolFactory public immutable poolFactory;
HoloFiCardPriceFeed public immutable priceFeed;

mapping(uint256 => CollateralVault) public vaults;
mapping(uint256 => uint256) public nftVaultId; // Fast lookup mapping (tokenId => vaultId)
uint256 public nextVaultId = 1;
```

#### B. KYB Control & Escrow Mechanics

* **Vault Creation (`createVault`)**:
  - Restricted to KYB-approved store wallets (`acm.isKybApproved(msg.sender)`). Reverts with `KybRequired(msg.sender)` if unapproved.
  - Requires a valid, registered lending pool (`poolFactory.isValidPool(lendingPool)`). Reverts with `UnregisteredLendingPool(lendingPool)` if unapproved.
  - Assigns unique `vaultId = nextVaultId++`, binds `vault.lendingPool = lendingPool`, and sets `status = VaultStatus.Active`.

* **Escrow Deposit (`depositCollateral`)**:
  - Stores can add card NFTs to their active vault at any time.
  - **Card Eligibility Validation**: Queries `HoloFiLendingPool(vault.lendingPool).isCollateralAllowed(card.cardTypeId)`. If the card is ineligible according to the bound pool's policy, the transaction reverts with `IneligibleCollateral(tokenId, cardTypeId, lendingPool)`.
  - Executes `vaultCard.safeTransferFrom(msg.sender, address(this), tokenId)` and locks cards via `vaultCard.setCardLock(tokenId, true)` to prevent secondary transfers.
  - Registers `nftVaultId[tokenId] = vaultId` and pushes `tokenId` to `vault.tokenIds`.

* **LTV-Guarded Escrow Withdrawal (`withdrawCollateral`)**:
  - Stores can withdraw specific card NFTs from their vault.
  - **Interest Accrual Guard**: Triggers `accrueInterest(vaultId)` **first**.
  - **Zero Debt vs Active Debt LTV Check**:
    - If total debt is 0 (`currentTotalDebt == 0`): Allows withdrawing any or all requested `tokenIds`.
    - If active debt exists (`currentTotalDebt > 0`): Computes remaining collateral value `remainingFmv` after removing `tokenIds`. Verifies `currentTotalDebt <= getMaxBorrowCapacity(vaultId, remainingFmv)`. Reverts with `InsufficientCollateralRatio` if the remaining collateral breaches safety thresholds.
  - Unlocks cards via `vaultCard.setCardLock(tokenId, false)` and returns NFTs via `vaultCard.safeTransferFrom(address(this), vault.owner, tokenId)`.
  - Clears `nftVaultId[tokenId]` and removes token from `vault.tokenIds`.

#### C. Risk Engine & Accounting Mechanics

* **Decentralized Pool-Level Risk Parameters**:
  - Each `HoloFiLendingPool` defines and isolates its own 4 risk parameters (`maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, and `borrowRateBpsPerYear`).
  - Configurable by `ADMIN_ROLE` on each pool via `setRiskParameters(...)`. Reverts `InvalidRiskParameters()` if `maxLtvBps > liquidationThresholdBps` or `liquidationThresholdBps > 10000`.

* **Continuous Interest Accrual (`accrueInterest`)**:

$$\Delta t = \text{block.timestamp} - \text{lastInterestUpdateTime}$$

$$\text{borrowRate} = \text{HoloFiLendingPool}(\text{vault.lendingPool}).\text{borrowRateBpsPerYear}()$$

$$\text{Interest}_{\text{new}} = \frac{\text{principalDebt} \times \text{borrowRate} \times \Delta t}{10000 \times 365\text{ days}}$$

$$\text{accumulatedInterest} \leftarrow \text{accumulatedInterest} + \text{Interest}_{\text{new}}$$

* **Health Factor Engine (`getHealthFactor`)**:
  - Calculates Health Factor scaled with `1e18` precision querying `liquidationThresholdBps` dynamically from `vault.lendingPool`:

$$HF = \frac{\text{Vault FMV} \times \text{liquidationThresholdBps} \times 1\text{e}18}{\text{Total Debt} \times 10000}$$

  - Returns `type(uint256).max` if total debt is 0.

* **Max Borrow Capacity (`getMaxBorrowCapacity`)**:
  - Queries `maxLtvBps` dynamically from `vault.lendingPool`:

$$\text{MaxBorrow} = \text{Vault FMV} \times \frac{\text{maxLtvBps}}{10000}$$

#### D. Oracle Valuation, Pool Guard & Debt Settlement Mechanics

* **Card Price Feed Architecture (`HoloFiCardPriceFeed`)**:
  - Off-chain oracle pricing is decoupled into `HoloFiCardPriceFeed`, mapping `cardTypeId` $\rightarrow$ `PriceData(price, lastUpdated)` where `price` is packed 128-bit USD FMV (18 decimals) and `lastUpdated` is a 128-bit timestamp in a single storage slot.
  - Card type registration and enumeration is managed via OpenZeppelin's `EnumerableSet.Bytes32Set` (`_cardTypeIds`).
  - Updates are performed via `setPrice(cardTypeId, price)` or `setBatchPrices(cardTypeIds, prices)` by authorized `ORACLE_ROLE` callers, which automatically register new card type IDs into the set without duplication.
  - Enumeration and query interfaces:
    - `getCardTypesCount()`: Returns total number of registered card types.
    - `getCardTypeAt(uint256 index)`: Returns the card type ID at a specific index.
    - `getAllCardTypes()`: Returns an array of all registered card type IDs.
    - `isSupportedCardType(bytes32 cardTypeId)`: Returns whether a card type ID is registered in the feed.

* **Vault Valuation Aggregation (`getVaultFMV`)**:
  - Computes total collateral value by querying `cardTypeId = vaultCard.getCard(tokenId).cardTypeId` and calling `priceFeed.getPrice(cardTypeId)` across all deposited cards in `vaults[vaultId].tokenIds`.

* **Credit Borrow Execution (`borrow`)**:
  - Restricted to vault owner (`msg.sender == vault.owner`). Reverts `UnauthorizedVaultOwner` if unauthorized.
  - Requires active vault status (`VaultNotActive`) and non-zero borrow amount (`ZeroBorrowAmount`).
  - **Interest Accrual Guard**: Triggers `accrueInterest(vaultId)` **first** prior to state updates.
  - **LTV Capacity Check**: Verifies `getTotalDebt(vaultId) + amount <= getMaxBorrowCapacity(vaultId, getVaultFMV(vaultId))`. Reverts with `ExceedsMaxBorrowCapacity` if requested debt exceeds max LTV limit.
  - Increases `vault.principalDebt += amount`.
  - Executes `HoloFiLendingPool(vault.lendingPool).drawLiquidity(vault.owner, amount)` to transfer underlying asset liquidity directly from the bound pool to store.
  - Emits `BorrowExecuted(vaultId, vault.owner, vault.lendingPool, amount, vault.principalDebt)`.

* **Debt Repayment (`repay`)**:
  - Requires active vault status (`VaultNotActive`), non-zero amount (`ZeroRepayAmount`), and active debt (`NoActiveDebt`).
  - **Interest Accrual Guard**: Triggers `accrueInterest(vaultId)` **first**.
  - **Waterfall Allocation**: Pays off `accumulatedInterest` first, then reduces `principalDebt`. Caps repayment at total active debt.
  - Calls `HoloFiLendingPool(vault.lendingPool).returnLiquidity(msg.sender, actualRepay)` to transfer funds from payer into bound lending pool.
  - Emits `RepaymentExecuted(vaultId, msg.sender, vault.lendingPool, actualRepay, interestPaid, principalPaid, vault.principalDebt, vault.accumulatedInterest)`.

* **Atomic Repay & Withdraw (`repayAndWithdraw`)**:
  - Allows stores to pay down debt and release specific card NFTs in a single transaction.
  - **Authorization Guard**: Explicitly verifies `vaults[vaultId].owner == msg.sender` if `withdrawTokenIds.length > 0` before executing repayment or withdrawal.
  - Atomically calls `repay(vaultId, repayAmount)` and `withdrawCollateral(vaultId, withdrawTokenIds)`.

---

### 3.4. Multi-Asset Pool Factory & Liquidity Pools: `HoloFiLendingPoolFactory` & `HoloFiLendingPool`

### 3.4. Multi-Asset Pool Factory & Liquidity Pools: `HoloFiLendingPoolFactory` & `HoloFiLendingPool`

* **Multi-Asset Pool Factory (`HoloFiLendingPoolFactory`)**:
  - Centralized factory for deploying and registering permissioned `HoloFiLendingPool` instances.
  - Maintains on-chain lookup mappings: `mapping(address => address[]) public poolsByAsset`, `mapping(address => bool) public isValidPool`, and `address[] public allPools`.
  - Supports deploying multiple distinct pools per underlying asset with customized risk parameters and collateral eligibility tiers.
  - Automatically marks `isValidPool[pool] = true` upon instantiation for protocol security verification.

* **Permissioned ERC-4626 Lending Pool (`HoloFiLendingPool`)**:
  - Encapsulates risk parameters (`maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, `borrowRateBpsPerYear`) per asset.
  - Validates `maxLtvBps <= liquidationThresholdBps <= 10000` on creation and during parameter adjustments via `setRiskParameters`.
  - Emits `RiskParametersUpdated` whenever risk parameters are updated by admin.
  - Holds an optional `eligibilityPolicy` address pointing to an `ICardEligibilityPolicy` implementation.
  - Configurable by `ADMIN_ROLE` via `setEligibilityPolicy(address)` emitting `EligibilityPolicyUpdated(address)`.
  - Exposes `isCollateralAllowed(bytes32 cardTypeId)`: returns `true` if `eligibilityPolicy == address(0)` (unrestricted/open mode, e.g. Deluxe Pool), or delegates to `policy.isCardTypeEligible(cardTypeId)` (e.g. Premium Pool).

* **Illiquidity Gate**:
  If available free liquidity in the pool is insufficient during a borrow request (`IERC20(asset).balanceOf(address(this)) < amount`):

$$\text{Asset}_{\text{available}} = \text{Balance}_{\text{Asset}}$$

  The contract throws custom error `InsufficientVaultLiquidity(available, required)` and reverts the transaction.

---

### 3.5. Card Eligibility Policy Engine: `ICardEligibilityPolicy` & `GradeEligibilityPolicy`

To enforce collateral quality standards across different credit tiers (e.g. Premium Pool accepting only PSA 10 cards vs. Deluxe Pool accepting broader inventory), HoloFi provides a modular policy strategy engine:

* **Policy Interface (`ICardEligibilityPolicy`)**:
  - Canonical 8-attribute card structure:
    ```solidity
    struct CardAttributes {
        string game;        // e.g. "Pokemon"
        string language;    // e.g. "EN"
        string setName;     // e.g. "Base Set"
        string cardName;    // e.g. "Charizard"
        string cardNumber;  // e.g. "4/102"
        string printing;    // e.g. "1st Edition"
        string grader;      // e.g. "PSA"
        string grade;       // e.g. "10"
    }
    ```
  - `computeCardTypeId(CardAttributes)`: Computes deterministic `keccak256(abi.encode(attrs))` card type ID.
  - `registerCardType(CardAttributes)`: Evaluates attributes against criteria and registers eligibility.
  - `isCardTypeEligible(bytes32 cardTypeId)`: Returns whitelist status for deposited cards.

* **Grade & Grader Range Policy (`GradeEligibilityPolicy`)**:
  - Filters by grader string (e.g. `"PSA"`, or empty for any grader) and numeric grade bounds (`minGrade` and `maxGrade`).
  - Implements `parseGrade(string)` to parse ASCII grade numbers into integer `uint256` values for comparison ($\ge 10$, $\le 9$, exact grades, or bounded intervals).
  - Protected by `MINTER_ROLE`: Only accounts holding `MINTER_ROLE` can invoke `registerCardType` or manual override `setCardTypeOverride(cardTypeId, eligible)`.

---

### 3.6. Liquidation Engine: `HoloFiDutchAuction`

Activated when a store vault's Health Factor ($HF$) falls below 1.0:

$$HF = \frac{\text{Vault FMV} \times \text{liquidationThresholdBps}}{\text{Total Debt} \times 10000} < 1.0$$

#### A. Dutch Auction Initiation & Parameters (`startAuction`)

1. **State Locking**: Calling `startAuction(vaultId)` verifies $HF < 1.0$, triggers `loanCore.startLiquidation(vaultId)`, reads `liquidationPenaltyBps` dynamically from `vault.lendingPool`, and updates the target vault to `Liquidating` status. The store cannot borrow, repay, or withdraw assets while liquidating.

2. **Linear Price Decay Function (`getAuctionPrice`)**:
* **Start Price ($P_{\text{start}}$)**: $\text{Vault FMV} \times \frac{12000}{10000}$ (120.00% of Vault FMV)
* **Reserve Price ($P_{\text{reserve}}$)**: Total Debt ($\text{principalDebt} + \text{accumulatedInterest}$) + Penalty Fee ($\text{debt} \times \text{liquidationPenaltyBps} / 10000$)
* **Default Auction Duration ($T_{\text{auction}}$)**: 48 hours.

$$\text{CurrentPrice}(t) = P_{\text{start}} - \left( (P_{\text{start}} - P_{\text{reserve}}) \times \frac{t - t_{\text{start}}}{48\text{ hours}} \right)$$

#### B. Auction Settlement & Fund Distribution (`settleAuction`)

When a liquidator calls `settleAuction(vaultId)` paying $\text{CurrentPrice}(t)$ in underlying asset tokens:

```text
Liquidator Buyer
    │
    │ 1. Pays CurrentPrice(t) in ERC-20 Asset
    ▼
HoloFiDutchAuction Contract
    │
    ├───► 2. Transfer Debt Amount (returnLiquidity) ──► Bound HoloFiLendingPool (ERC-4626)
    │                                                   (Full Principal + Interest Clearance)
    │
    ├───► 3. Transfer Penalty Amount ────────────────► Bound HoloFiLendingPool (ERC-4626)
    │
    ├───► 4. Transfer Surplus (If any) ───────────────► Original Store (Vault Owner)
    │
    └───► 5. finalizeLiquidation ─────────────────────► HoloFiVaultLoanCore
                                                        │
                                                        └─► Unlock & Transfer NFTs ──► Liquidator Address
                                                             (Emit AuctionSettled & VaultLiquidated)
```

#### C. Protocol Treasury Buyback (`treasuryBuyback`)

For auctions that expire after the 48-hour duration without receiving public bids, the authorized Protocol Treasury wallet (`treasury`) can execute a backstop buyback:

1. **Role & Expiration Validation**: Enforces `msg.sender == treasury` (`UnauthorizedTreasury`) and `block.timestamp >= auction.startTime + 48 hours` (`AuctionNotExpired`).
2. **Debt-Only Settlement**: The Treasury pays exactly 100% of the loan debt (`debtAmount`) into bound `vault.lendingPool` via `returnLiquidity(address(this), debtAmount)`. The penalty fee is waived for Treasury to maximize capital efficiency.
3. **Physical Collateral Assignment**: Calls `loanCore.finalizeLiquidation(vaultId, msg.sender)` to assign the physical card NFT(s) directly to the Protocol Treasury wallet for off-chain liquidation.

---

## 4. Sequence Diagrams

### 4.1. Store Borrow Sequence

```text
Store               Front-End / CRE           LoanCore Contract       Bound Lending Pool
   │                       │                          │                      │
   │─── 1. createVault(pool) ────────────────────────►│                      │
   │                       │                          │                      │
   │─── 2. depositCollateral ────────────────────────►│                      │
   │                       │                          │                      │
   │─── 3. borrow(vaultId, amount) ──────────────────►│                      │
   │                       │                          │── 4. Verify MaxBorrow│
   │                       │                          │   (using pool's LTV) │
   │                       │                          │                      │
   │                       │                          │── 5. drawLiquidity ─►│
   │                       │                          │   Request            │
   │                       │                          │                      │
   │◄───────────────── 6. Transfer Asset ─────────────┼──────────────────────│
```

---

### 4.2. Dutch Auction Liquidation Sequence

```text
Keeper / Liquidator        DutchAuction Contract       LoanCore Contract       Bound Lending Pool
        │                            │                         │                      │
        │── 1. startAuction(vaultId) ┼────────────────────────►│                      │
        │                            │── 2. Check HF < 1.0 ───►│                      │
        │                            │   Lock Vault Status     │                      │
        │                            │                         │                      │
        │── 3. settleAuction(vaultId)┼────────────────────────►│                      │
        │   (Pay CurrentPrice Asset) │── 4. Repay Debt ───────►│──► Repay Pool ───────│
        │                            │── 5. Pay Surplus ──────►│──► Transfer Store    │
        │                            │                         │                      │
        │◄── 6. Transfer NFTs ───────│                         │                      │
        │                            │                                                │
        │                            └────── 7. Emit Event AuctionSettled ───────────►│
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
