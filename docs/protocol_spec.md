# HoloFi Protocol
## Product Whitepaper and Specification

> **Version**: v1.0  
> **Date**: 2026-08-23  
> **Protocol Scope**: Decentralized lending and Dutch auction liquidation protocol backed by physical TCG card RWA assets  
> **Target Networks**: Base (OP Stack L2) / Ethereum L1

---

## Table of Contents

1. [Value Proposition](#1-value-proposition)
2. [System Architecture](#2-system-architecture)
3. [Component Specifications](#3-component-specifications)
4. [Functional Blueprint](#4-functional-blueprint)
5. [High-Level Data Flow](#5-high-level-data-flow)

---

## 1. Value Proposition

### 1.1 Market Pain Points

The physical Trading Card Game (TCG) market is large. However, it faces the following structural problems:

| Pain Point Dimension | Current Situation |
|:---|:---|
| **Illiquidity** | Liquidation of physical cards takes weeks to months. Sellers depend on offline deals, auction houses, or e-commerce platforms. |
| **Opaque Valuation** | Card market prices are fragmented. The market lacks standardized on-chain fair market value anchors. |
| **Low Capital Efficiency** | Merchants cannot convert inventory cards into liquid capital. Capital utilization remains very low. |
| **High Trust Costs** | Cross-border transactions lack a unified, verifiable trust layer for custody, grading authentication, and settlement. |

### 1.2 The HoloFi Solution

HoloFi Protocol creates a closed-loop credit system for real-world assets (RWAs). The protocol uses a three-layer architecture:
1. **Physical Asset Tokenization**: Mints verifiable on-chain NFT vouchers for physically vaulted cards.
2. **ERC-4626 Lending Pools**: Provides standardized liquidity pools with pool-level risk isolation.
3. **Dutch Auction Liquidation Engine**: Runs market-based liquidations with Treasury buyback guarantees.

### 1.3 Value Matrix for Protocol Roles

| Role | Core Pain Point | Value Provided by HoloFi |
|:---|:---|:---|
| **Merchant / Borrower** | Inventory backlog of physical cards restricts cash flow. | Deposit authenticated physical cards into the Blink vault. Mint on-chain NFT vouchers. Borrow stablecoins instantly up to the **max LTV** of card fair market value (FMV). Access liquidity without selling assets. |
| **Liquidity Provider (LP)** | DeFi yields continue to decline. High-quality yields backed by real-world assets are scarce. | Deposit stablecoins into ERC-4626 lending pools. Earn dual yield from **borrow interest and liquidation penalties**. Physical cards fully over-collateralize all loans. Non-transferable LP share tokens eliminate systemic secondary market run risks. |
| **Liquidator / Arbitrageur** | Liquidators need efficient, permissionless liquidation opportunities. | When a vault health factor falls below 1.0, a 48-hour Dutch auction starts at **120% FMV** and decreases linearly to the reserve price. Liquidators can participate permissionlessly at any time to acquire premium card NFTs at a discount. |
| **Protocol Treasury** | The protocol must prevent bad debt from affecting lending pools. | If an auction expires with no buyer, the Protocol Treasury buys back the collateral at the **exact debt amount** (zero penalty fee). This mechanism guarantees zero principal loss for LPs and acquires physical card assets at low cost. |

### 1.4 Differentiating Competitive Advantages

```
┌─────────────────────────────────────────────────────────┐
│              HoloFi Differentiating Moats               │
├─────────────────────────────────────────────────────────┤
│ ① Physical Custody Backing │ Each NFT binds a unique    │
│                            │ attestationHash. It        │
│                            │ supports raw data checks.  │
│                            │ The hash is unique globally│
├────────────────────────────┼────────────────────────────┤
│ ② Zero Bad-Debt Mechanism  │ Dutch auctions and Treasury│
│                            │ buybacks form a dual       │
│                            │ safety net for LP capital. │
├────────────────────────────┼────────────────────────────┤
│ ③ KYB Access Control       │ Borrowers must pass KYB    │
│                            │ verification. This rule    │
│                            │ stops anonymous bad actors.│
├────────────────────────────┼────────────────────────────┤
│ ④ Card Type Price Feed     │ PriceFeed supplies prices  │
│    (PriceFeed)             │ by cardTypeId. It supports │
│                            │ single and batch updates.  │
├────────────────────────────┼────────────────────────────┤
│ ⑤ Atomic Operations        │ The protocol supports      │
│                            │ atomic Repay + Withdraw.   │
│                            │ This avoids bad states.    │
├────────────────────────────┼────────────────────────────┤
│ ⑥ Pool-Level Risk Settings │ Each pool configures its   │
│                            │ own LTV, liquidation       │
│                            │ threshold, and rate params.│
├────────────────────────────┼────────────────────────────┤
│ ⑦ Collateral Eligibility   │ Pluggable EligibilityPolicy│
│                            │ filters collateral by card │
│                            │ grader and grade score.    │
├────────────────────────────┼────────────────────────────┤
│ ⑧ Full Emergency Pause     │ LoanCore, DutchAuction, and│
│                            │ LendingPool implement the  │
│                            │ Pausable security pattern. │
└─────────────────────────────────────────────────────────┘
```

---

## 2. System Architecture

### 2.1 Layered Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       External Actors Layer                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│   │ Merchant │  │ Liquidity│  │Liquidator│  │ Oracle / Admin   │   │
│   │ Borrower │  │    LP    │  │   Bot    │  │                  │   │
│   └─────┬────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
└─────────┼────────────┼─────────────┼─────────────────┼──────────────┘
          │            │             │                 │
┌─────────▼────────────▼─────────────▼─────────────────▼──────────────┐
│                    Core Protocol Contracts Layer                    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                Access Control Manager (ACM)                  │    │
│  │    Role Definitions · KYB Whitelist · Role Checks · Pause    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐     │
│  │ NFT Asset Card │  │ Loan Core      │  │ Dutch Auction      │     │
│  │ (Vault Card)   │  │ Engine         │  │ Liquidation Engine │     │
│  │                │  │                │  │                    │     │
│  │ · Mint & Proof │◄─│ · Vault Mgmt   │─►│ · Start/Decay/Settle│    │
│  │ · Lock & Unlock│  │ · Borrow & Int.│  │ · Fund Allocation  │     │
│  │ · Burn & Verify│  │ · Repay & Draw │  │ · Treasury Buyback │     │
│  └────────────────┘  └───────┬────────┘  └────────────────────┘     │
│                              │                                       │
│  ┌──────────────────┐  ┌─────▼──────────────────────────────────┐   │
│  │ Card Price Feed  │  │       Lending Pool Factory             │   │
│  │ (CardPriceFeed)  │  │  Deploy & register ERC-4626 pools      │   │
│  │ · cardTypeId feed│  │  Multiple risk profiles per asset      │   │
│  │ · Batch updates  │  └──────────────────┬──────────────────────┘   │
│  │ · 18-dec. USD    │                     │                          │
│  └──────────────────┘  ┌──────────────────▼──────────────────────┐   │
│                        │       ERC-4626 Lending Pool             │   │
│  ┌──────────────────┐  │  LP Deposit · pToken Mint · Liquidity   │   │
│  │ Collateral       │  │  Interest Flow · Pool Risk · Pause      │   │
│  │ Eligibility      │  └─────────────────────────────────────────┘   │
│  │ (Policy)         │                                                │
│  │ · Grader filter  │                                                │
│  └──────────────────┘                                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                  Utility Library (DecimalMath)               │    │
│  │         Convert 18-decimal USD ↔ ERC-20 Asset Decimals       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────────────┐
│                      Underlying Dependencies Layer                   │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐   │
│  │ OpenZeppelin 5.x    │  │ EVM Compatible Layer (Base/Ethereum) │   │
│  │ · ERC-721 + URI     │  │ · Solidity 0.8.28                    │   │
│  │ · ERC-4626 / ERC-20 │  │ · Hardhat 3 Framework                │   │
│  │ · AccessControl     │  │                                      │   │
│  │ · ReentrancyGuard   │  │                                      │   │
│  │ · Pausable          │  │                                      │   │
│  │ · EnumerableSet     │  │                                      │   │
│  └─────────────────────┘  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Inter-Contract Call Diagram

```
                     ┌─────────────────┐
                     │  Access Control │
                     │     Manager     │
                     └────────┬────────┘
                              │ (Permission checks / Pause control)
           ┌──────────────────┼───────────────────────┐
           │                   │                       │
           ▼                   ▼                       ▼
   ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐
   │  Vault Card   │  │  Pool Factory │  │  Dutch Auction   │
   │  (ERC-721)    │  │               │  │  (Liquidation)   │
   └───────┬───────┘  └───────┬───────┘  └───────┬──────────┘
           │                   │                  │
           │   ┌───────────────▼──────────────┐   │
           │   │       Lending Pool           │   │
           │   │       (ERC-4626)             │   │
           │   │  ┌─ Pool Risk Parameters     │   │
           │   │  └─ Eligibility Policy ◄─────┼─── Eligibility Policy
           │   └───────────────┬──────────────┘   │
           │                   │                  │
           │   ┌───────────────▼──────────────┐   │
           └──►│          Loan Core           │◄──┘
               │  (Credit & Vault Custody)    │
               └───────────────┬──────────────┘
                               │
               ┌───────────────▼──────────────┐
               │        CardPriceFeed         │
               │    (Card Price Oracle)       │
               └──────────────────────────────┘

Call Direction Descriptions:
  Loan Core ──► Vault Card      : Lock and unlock NFTs (LOCKER_ROLE), safe transfers
  Loan Core ──► Lending Pool    : drawLiquidity (borrow) / returnLiquidity (repay)
  Loan Core ──► Pool Factory    : isValidPool verifies pool validity
  Loan Core ──► CardPriceFeed   : Query FMV by cardTypeId
  Loan Core ──► Vault Card      : getCard reads cardTypeId of token
  Dutch Auction ──► Loan Core   : startLiquidation / finalizeLiquidation
  Dutch Auction ──► Lending Pool: returnLiquidity repays debt, penalty transfers directly to pool
  All Core Contracts ──► ACM    : Role validation and pause control
```

---

## 3. Component Specifications

### 3.1 Access Control Manager (`AccessControlManager`)

**Responsibility**: Centralized role-based access control manager. All protocol contracts delegate permission checks to this contract.

**Role System**:

| Role | Role Constant | Permission Scope | Admin Role |
|:---|:---|:---|:---|
| **Default Admin** | `DEFAULT_ADMIN_ROLE` | OpenZeppelin default administration role. Manages `ADMIN_ROLE`. | Self-managed |
| **Admin** | `ADMIN_ROLE` | Full operational control: configure risk parameters, update contract addresses, assign sub-roles, manage KYB whitelist, and unpause protocol. | `DEFAULT_ADMIN_ROLE` |
| **Oracle** | `ORACLE_ROLE` | Update fair market value (FMV) of card types in single and batch transactions. | `ADMIN_ROLE` |
| **KYB Manager** | `KYB_MANAGER_ROLE` | Approve or revoke KYB verification status for business entities. | `ADMIN_ROLE` |
| **Minter** | `MINTER_ROLE` | Mint NFT vouchers upon physical vault custody confirmation and register card types. | `ADMIN_ROLE` |
| **Locker** | `LOCKER_ROLE` | Lock and unlock NFT cards (held by the `LoanCore` contract). | `ADMIN_ROLE` |
| **Pauser** | `PAUSER_ROLE` | Trigger emergency pause on protocol contracts (`LoanCore`, `DutchAuction`, `LendingPool`). | `ADMIN_ROLE` |

**KYB Whitelist Mechanism**:
- Admins set KYB approval status per address with zero-address validation.
- Admins set KYB approval status in batches with a single status value.
- Borrowers must hold valid KYB verification when they create vaults, deposit collateral, and borrow funds.
- Admins or designated KYB managers execute KYB reviews.
- Each status change records the operator address.

---

### 3.2 Card Price Oracle (`HoloFiCardPriceFeed`)

**Responsibility**: Independent on-chain price registry. Manages fair market value (FMV) by card type (`cardTypeId`) for collateral valuation in `LoanCore`.

**Core Mechanisms**:

| Feature | Description |
|:---|:---|
| **`cardTypeId` Addressing** | The contract indexes prices by `bytes32 cardTypeId`. All cards of the same type share one price. |
| **18-Decimal Precision** | The contract stores prices as `uint128` in 18-decimal USD. `LoanCore` converts these values to pool asset precision with `DecimalMath`. |
| **Timestamp Tracking** | Each price update records a `lastUpdated` timestamp to enable freshness validation. |
| **Type Registry** | Uses `EnumerableSet` to track all registered `cardTypeId` keys. Supports enumeration and key existence checks. |
| **Oracle-Only Updates** | Restricts price feed updates strictly to accounts with `ORACLE_ROLE`. Rejects zero prices. |

**Data Structure**:

```solidity
struct PriceData {
    uint128 price;       // 18-decimal USD fair market value
    uint128 lastUpdated; // Block timestamp of the latest update
}
```

**Supported Query Functions**:
- `getPrice(cardTypeId)` — Query price for a single card type.
- `getCardTypesCount()` — Return total number of registered card types.
- `getCardTypeAt(index)` — Enumerate card types by index.
- `getAllCardTypes()` — Return all registered card types.
- `isSupportedCardType(cardTypeId)` — Verify if a card type exists in the registry.

---

### 3.3 Lending Pool Factory (`HoloFiLendingPoolFactory`)

**Responsibility**: Deploys and registers standardized lending pool instances. Enables creation of multiple risk-profiled pools for the same underlying asset.

**Core Mechanisms**:

| Feature | Description |
|:---|:---|
| **Multi-Pool Model** | One underlying ERC-20 asset can back multiple lending pools. Each pool maintains isolated risk parameters and collateral policies. |
| **Pool Registry** | Maintains a global `isValidPool` mapping. Other contracts verify pool validity through this factory. |
| **Lifecycle Control** | Admins enable or disable pools via `setPoolStatus` to control pool operations. |
| **Pool Risk Parameters** | Each pool defines `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, and `borrowRateBpsPerYear` during deployment. |
| **Admin-Only Deployment** | Restricts pool creation and status updates strictly to accounts with `ADMIN_ROLE`. |

**Workflow**:

```
Admin ──(Asset + Name + Symbol + 4 Risk Parameters)──► Factory Contract
       │
       ├─ Verify: ADMIN_ROLE permission ✓
       ├─ Verify: Asset address is not zero ✓
       ├─ Verify: maxLTV ≤ liquidationThreshold ≤ 100% ✓
       ├─ Deploy: New ERC-4626 Lending Pool contract with pool risk parameters
       ├─ Register: Store [Asset Address → Pool Address[]] mapping (one-to-many)
       └─ Set Flag: Mark pool address as valid in isValidPool registry
```

---

### 3.4 NFT Asset Voucher (`HoloFiVaultCard`)

**Responsibility**: Represents physically vaulted and authenticated TCG cards as on-chain ERC-721 NFTs. Provides locking controls for credit operations.

**Card Metadata Structure**:

```solidity
struct CardMetadata {
    uint256 tokenId;         // Incremental on-chain unique identifier (starts at 1)
    bytes32 cardTypeId;      // Card type identifier (links to PriceFeed and EligibilityPolicy)
    bytes32 attestationHash; // Keccak-256 hash of physical attestation data (globally unique)
    uint256 mintTimestamp;   // Block timestamp of minting
    bool isLocked;           // True if the card is locked as loan collateral
}
```

**Core Mechanisms**:

- **Minting (`mintCard`)**: Only Minters or Admins can mint cards. Callers must provide non-zero `cardTypeId`, `attestationHash`, and `tokenURI`. The `attestationHash` is globally unique. The contract rejects previously minted hashes.
- **Locking and Unlocking (`setCardLock`)**: Only `LOCKER_ROLE` or `ADMIN_ROLE` can change lock states. When a user deposits a card into a loan vault, the contract locks the card. Locked cards cannot be transferred.
- **Burning (`burnCard`)**: Card owners or approved operators can burn unlocked cards. Burning releases the `attestationHash` for future reuse.
- **Attestation Verification (`verifyAttestation`)**: Any user can submit raw attestation data. The contract computes the Keccak-256 hash and compares it with the stored `attestationHash`.

> [!IMPORTANT]
> The contract enforces card locks at the ERC-721 transfer layer. Any transfer attempt on a locked card (standard or safe transfer) reverts automatically. Global uniqueness of `attestationHash` prevents duplicate tokenization of any physical card.

---

### 3.5 Loan Core Engine (`HoloFiVaultLoanCore`)

**Responsibility**: Central credit and collateral custody engine. Manages the full vault lifecycle: creation, collateral deposits and withdrawals, borrow executions, interest calculations, repayments, and liquidation triggers.

#### 3.5.1 Collateral Vault State Machine

```
                  Create Vault (KYB Verified + Select Lending Pool)
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │    Active    │
                                  └──────┬───────┘
                                         │
                          ┌──────────────┼──────────────┐
                          │              │              │
                   Deposit/Withdraw Borrow/Repay  Health Factor < 1.0
                          │              │              │
                          └──────────────┤              │
                                         │              ▼
                                         │     ┌────────────────┐
                                         │     │  Liquidating   │
                                         │     └───────┬────────┘
                                         │             │
                                         │     Auction Settle /
                                         │     Treasury Buyback
                                         │             │
                                         │             ▼
                                         │     ┌────────────────┐
                                         │     │    Closed      │
                                         │     └────────────────┘
                                         │
                              When debt is fully repaid:
                              Withdraw all collateral
```

#### 3.5.2 Risk Parameter System

> [!NOTE]
> Risk parameters are configured at the **pool level** rather than globally. Each lending pool defines these parameters at creation. Admins can adjust them dynamically. When a borrower creates a vault, the vault binds to a specific lending pool. All subsequent borrowing, interest accrual, and liquidations use the parameters of that pool.

| Parameter | Storage Location | Typical Default | Precision | Description |
|:---|:---|:---|:---|:---|
| **Max Loan-to-Value (`maxLtvBps`)** | LendingPool | 50% | Basis Points (BPS) | Maximum borrowable proportion of collateral FMV |
| **Liquidation Threshold (`liquidationThresholdBps`)** | LendingPool | 70% | Basis Points (BPS) | Weight for health factor calculation. Must be $\ge$ maxLTV |
| **Liquidation Penalty (`liquidationPenaltyBps`)** | LendingPool | 10% | Basis Points (BPS) | Additional penalty percentage added to debt during liquidation |
| **Annual Borrow Rate (`borrowRateBpsPerYear`)** | LendingPool | 5% | Basis Points (BPS) | Annual interest rate applied linearly per second |

All risk parameters use basis points ($1\text{ BPS} = 0.01\%$) with a fixed denominator of 10,000. Parameter constraint rule: $\text{maxLtvBps} \le \text{liquidationThresholdBps} \le 10,000$.

#### 3.5.3 Core Calculation Formulas

**① Maximum Borrow Capacity**

$$
\text{Max Borrow Capacity} = \text{normalizeToAsset}\!\left(\frac{\text{Total Vault FMV}_{18} \times \text{maxLtvBps}}{\text{BPS Denominator (10000)}}\right)
$$

The contract stores FMV in 18-decimal precision. It converts the output to the pool asset decimals (e.g. 6 decimals for USDC) via `DecimalMath.normalizeToAsset()`.

*Example*: Total Vault $\text{FMV} = 10,000 \times 10^{18}$, $\text{maxLtvBps} = 5000$ (50%), Asset = USDC (6 decimals)  
$\rightarrow \text{Max Capacity} = \text{normalizeToAsset}(10,000 \times 10^{18} \times 5000 / 10000) = \mathbf{5,000 \times 10^6\text{ (5,000 USDC)}}$

---

**② Interest Calculation (Linear Per-Second with Precision Compensation)**

$$
\text{New Interest} = \frac{\text{Principal Debt} \times \text{borrowRateBpsPerYear} \times \Delta t}{\text{BPS Denominator (10000)} \times \text{Seconds Per Year (31,536,000)}}
$$

When interest accrues, the contract updates `lastInterestUpdateTime` using the `accountedDt` compensation formula. This prevents rounding error accumulation:

$$
\text{accountedDt} = \left\lceil \frac{\text{interestNew} \times \text{BPS} \times \text{SECONDS\_PER\_YEAR}}{\text{principalDebt} \times \text{borrowRate}} \right\rceil
$$

*Example*: Principal = 5,000 USDC, Annual Rate = 5%, Elapsed Time = 30 days (2,592,000 seconds)  
$\rightarrow \text{New Interest} = 5,000 \times 10^6 \times 500 \times 2,592,000 / (10,000 \times 31,536,000) \approx \mathbf{20.55\text{ USDC}}$

---

**③ Total Debt**

$$
\text{Total Debt} = \text{Principal Debt} + \text{Accrued Interest} + \text{Pending Interest}
$$

---

**④ Health Factor**

$$
\text{Health Factor} = \frac{\text{normalizeToAsset(Total Vault FMV)} \times \text{liquidationThresholdBps} \times 10^{18}}{\text{Total Debt} \times \text{BPS Denominator (10000)}}
$$

- Health Factor $\ge 1.0$ ($10^{18}$): The position is healthy.
- Health Factor $< 1.0$ ($10^{18}$): The position is eligible for liquidation.
- When total debt equals zero: Health Factor = $\infty$ (`type(uint256).max`).

*Example*: Vault FMV (normalized) = 7,000 USDC, Total Debt = 5,100 USDC, Liquidation Threshold = 70%  
$\rightarrow \text{Health Factor} = (7,000 \times 10^6 \times 7,000 \times 10^{18}) / (5,100 \times 10^6 \times 10,000) = 0.96 \times 10^{18} \rightarrow \mathbf{Eligible\ for\ Liquidation}$

---

**⑤ Repayment Allocation**

```
When Repayment Amount ≤ Total Debt:
  ├─ If Repayment Amount ≤ Accrued Interest: Pay interest only.
  └─ If Repayment Amount > Accrued Interest:
       ├─ Deduct all accrued interest first.
       └─ Deduct the remaining balance from Principal Debt.

When Repayment Amount > Total Debt:
  └─ Actual Payment = Total Debt (refund excess funds to caller).
```

#### 3.5.4 Collateral Management

- **Deposit**: Borrowers safely transfer NFTs to the `LoanCore` contract. The contract locks the cards with `LOCKER_ROLE` and registers the token IDs in the vault. A card cannot reside in multiple vaults at the same time. The contract verifies borrower KYB status and confirms pool eligibility via `isCollateralAllowed(cardTypeId)`.
- **Withdrawal**: When a vault has outstanding debt, the contract calculates the FMV of the requested cards. It confirms that the remaining collateral covers the current debt under max LTV. When debt is zero, the borrower can withdraw collateral without restriction.
- **Atomic Repay and Withdraw**: The protocol supports repaying debt and withdrawing collateral in a single transaction. This prevents intermediate LTV check failures.

#### 3.5.5 FMV Price Feed Mechanism

- The independent `HoloFiCardPriceFeed` contract manages card valuations. Oracles with `ORACLE_ROLE` set prices by `cardTypeId`.
- The contract supports single and batch price feed updates.
- Total vault FMV equals the sum of FMVs of all contained cards in 18-decimal precision.
- `LoanCore` scales 18-decimal FMV values to pool asset precision with `DecimalMath.normalizeToAsset()`.

#### 3.5.6 Pause Mechanism

The `LoanCore` contract implements the OpenZeppelin `Pausable` pattern:
- **Pause**: Accounts with `PAUSER_ROLE` or `ADMIN_ROLE` can pause the contract.
- **Unpause**: Only accounts with `ADMIN_ROLE` can unpause the contract.
- Actions blocked during pause: vault creation, collateral deposits, borrowing, collateral withdrawals, liquidation starts, and liquidation settlements.

---

### 3.6 ERC-4626 Lending Pool (`HoloFiLendingPool`)

**Responsibility**: Standardized and auditable liquidity infrastructure. Each pool manages its own risk parameters and collateral eligibility policy.

| Feature | Description |
|:---|:---|
| **Pool-Level Risk Parameters** | Each pool configures `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, and `borrowRateBpsPerYear`. Admins can update them dynamically. |
| **Collateral Eligibility Policy** | Pluggable `ICardEligibilityPolicy` contract filters allowed card types by `cardTypeId`. If no policy is set, the pool accepts all card types. |
| **LP Deposit** | Liquidity providers deposit underlying assets (e.g. USDC) and receive pool share tokens (`pToken`). |
| **LP Redeem** | Liquidity providers redeem share tokens for underlying assets subject to available pool liquidity. |
| **Non-Transferable Share Tokens** | Share tokens (`pToken`) disable peer-to-peer transfers. The contract allows only minting on deposit and burning on redeem. This prevents secondary market run risks. |
| **Liquidity Operations** | `drawLiquidity` releases liquidity to borrowers (`LoanCore` or Admin). `returnLiquidity` receives repayments (`LoanCore`, `DutchAuction`, or Admin). |
| **Interest and Penalty Inflow** | Repaid interest and liquidation penalties transfer directly into the pool. This increases the exchange rate of `pToken` to underlying assets. |
| **Inflation Attack Protection** | Implements 3 virtual decimals offset (`_decimalsOffset = 3`) to mitigate ERC-4626 donation and inflation attacks. |
| **Pause Mechanism** | Accounts with `PAUSER_ROLE` or `ADMIN_ROLE` can pause. Only accounts with `ADMIN_ROLE` can unpause. |

**`totalAssets` Calculation**:

$$
\text{totalAssets} = \text{Pool Asset Balance} + \text{totalBorrows (Outstanding Borrows)}
$$

**Permissions Matrix**:

```
┌─────────────────┬─────────┬───────────┬───────────┬──────────┐
│ Operation       │   LP    │ Loan Core │  Auction  │  Admin   │
├─────────────────┼─────────┼───────────┼───────────┼──────────┤
│ Deposit Assets  │    ✓    │           │           │          │
│ Redeem Shares   │    ✓    │           │           │          │
│ drawLiquidity   │         │     ✓     │           │    ✓     │
│ returnLiquidity │         │     ✓     │     ✓     │    ✓     │
│ Set Loan Core   │         │           │           │    ✓     │
│ Set Risk Params │         │           │           │    ✓     │
│ Set Policy      │         │           │           │    ✓     │
│ Pause / Unpause │         │           │           │   ✓/✓    │
│ Transfer Shares │    ✗    │     ✗     │     ✗     │    ✗     │
└─────────────────┴─────────┴───────────┴───────────┴──────────┘
```

---

### 3.7 Collateral Eligibility Policy (`ICardEligibilityPolicy`)

**Responsibility**: Pluggable collateral filter. Allows lending pools to specify custom qualification criteria for card types.

**Interface (`ICardEligibilityPolicy`)**:

| Method | Description |
|:---|:---|
| `computeCardTypeId(attrs)` | Computes the `bytes32 cardTypeId` from raw card attributes. |
| `registerCardType(attrs)` | Registers a card type and computes its eligibility status. |
| `isCardTypeEligible(cardTypeId)` | Queries whether a specific card type is eligible as collateral. |

**Card Attributes Structure (`CardAttributes`)**:

| Field | Example | Description |
|:---|:---|:---|
| `game` | "Pokemon" | Game or franchise name |
| `language` | "EN" | Language code |
| `setName` | "Base Set" | Card set name |
| `cardName` | "Charizard" | Card name |
| `cardNumber` | "4/102" | Card collector number |
| `printing` | "1st Edition" | Printing edition |
| `grader` | "PSA" | Authentication and grading agency |
| `grade` | "10" | Numerical grade score |

**Reference Implementation: `GradeEligibilityPolicy`**

Filters cards by grading agency and numerical grade range:
- `requiredGrader`: Specifies required grading agency (e.g. "PSA"). An empty string accepts all agencies.
- `minGrade` / `maxGrade`: Specifies acceptable grade range. A value of 0 removes that boundary check.
- Supports manual overrides (`setCardTypeOverride`) so authorized minters can force eligibility status.

---

### 3.8 Dutch Auction Liquidation Engine (`HoloFiDutchAuction`)

**Responsibility**: When a vault health factor falls below 1.0, this engine runs a time-decaying Dutch auction to liquidate collateral, repay pool debt, and return excess funds to the borrower.

#### 3.8.1 Auction Parameters

| Parameter | Value | Description |
|:---|:---|:---|
| **Start Price Multiplier** | 120% | Starts at 120% of vault FMV (scaled to pool asset decimals). If 120% FMV is below the reserve price, the auction starts at the reserve price. |
| **Auction Duration** | 48 Hours | Time window for the price to decrease linearly from start price to reserve price. |
| **Reserve Price (`reservePrice`)** | Total Debt + Liquidation Penalty | Minimum payment required to cover debt and liquidation penalty. |

#### 3.8.2 Price Decay Curve

$$
\text{Current Price} = \text{Start Price} - \frac{(\text{Start Price} - \text{Reserve Price}) \times \text{Elapsed Time}}{\text{Auction Duration}}
$$

```
Price
 ▲
 │  Start Price (120% FMV)
 │  ╲
 │    ╲
 │      ╲
 │        ╲
 │          ╲
 │            ╲  ← Linear Decay
 │              ╲
 │                ╲
 │──────────────────╲──── Reserve Price (Debt + Penalty) = reservePrice
 │
 └──────────────────────────────────────► Time
 0                                    48h
```

#### 3.8.3 Auction Settlement Fund Flow

When a liquidator buys the collateral at the current price, the contract distributes funds in this exact priority order:

```
Total Liquidator Payment (currentPrice)
    │
    ├─ Step 1: Transfer payment from liquidator to DutchAuction contract.
    │
    ├─ Step 2: Repay debt principal and interest to LendingPool via returnLiquidity.
    │          (principalPaid = vault.principalDebt, totalAmount = debtAmount)
    │
    ├─ Step 3: Transfer liquidation penalty directly to LendingPool contract address.
    │          (Extra yield to compensate LP risk)
    │
    ├─ Step 4: Refund excess surplus (currentPrice - reservePrice) to original vault owner.
    │
    └─ Step 5: Call finalizeLiquidation to unlock and transfer collateral NFTs to liquidator.
```

> [!TIP]
> The surplus refund protects borrower equity. When a vault holds high FMV collateral and a liquidator purchases it early at near 120% FMV, the borrower receives the remaining surplus balance.

#### 3.8.4 Treasury Buyback Mechanism (`treasuryBuyback`)

If no liquidator bids during the 48-hour auction window, the Protocol Treasury acts as buyer of last resort:

```
Auction Expires (48 hours with no buyer)
    │
    ├─ Only the designated Treasury address can call this function.
    │
    ├─ Step 1: Treasury pays the exact outstanding debt amount (zero penalty fee).
    │          ──► Transfer from Treasury to DutchAuction contract.
    │
    ├─ Step 2: Return debt amount to LendingPool via returnLiquidity.
    │          (LP principal is fully protected)
    │
    └─ Step 3: Call finalizeLiquidation to unlock and transfer all collateral NFTs to Treasury.
              (Treasury acquires physical card assets at low cost)
```

> [!IMPORTANT]
> **Zero Bad-Debt Guarantee for LPs**: Whether liquidation finishes via open-market settlement or Treasury buyback, the protocol fully repays the LP principal. The Treasury waives the penalty fee during buybacks as an operational cost to protect LP safety.

#### 3.8.5 Pause Mechanism

The `DutchAuction` contract integrates the `Pausable` pattern. Pausing blocks auction starts, settlements, and Treasury buybacks.

---

### 3.9 Utility Library (`DecimalMath`)

**Responsibility**: Standard conversion library between 18-decimal USD values and ERC-20 token native precisions.

| Method | Description |
|:---|:---|
| `normalizeToAsset(amount18, asset)` | Converts an 18-decimal amount to the native precision of a specified ERC-20 asset. |
| `scaleFrom18(amount18, targetDecimals)` | Scales an 18-decimal amount down to a target decimal precision. |
| `scaleTo18(amount, sourceDecimals)` | Scales an amount from a source decimal precision up to 18-decimal precision. |

---

## 4. Functional Blueprint

### 4.1 Module 1: Asset Minting and Custody

**Core Objective**: Transform physical TCG cards into programmable on-chain financial assets.

| Feature | Description |
|:---|:---|
| **Physical Custody Integration** | Blink vault inspects, authenticates, and vaults physical cards. |
| **On-Chain Attestation** | The contract hashes authentication data (e.g. PSA cert number, grade score) into `attestationHash`. This hash is unique globally and cannot be reused. |
| **Card Type Identification** | Binds `cardTypeId` at minting to link with `PriceFeed` and `EligibilityPolicy`. |
| **NFT Minting** | Accounts with `MINTER_ROLE` mint ERC-721 tokens with decentralized `tokenURI` links. |
| **Proof Verification** | Any user can call `verifyAttestation` with raw data to verify on-chain authenticity. |
| **Lock Controls** | When used as collateral, `LOCKER_ROLE` locks the card to prevent off-market transfers and double pledging. |
| **Burn and Release** | The token owner can burn unlocked cards to release the `attestationHash`. |

**State Control Flow**:

```
Physical Card ──[Vaulting & Grading]──► On-Chain Mint (Unlocked)
                                              │
                                   ──[Deposit into Vault]──► Locked (Non-transferable)
                                              │
                                   ──[Withdraw / Liquidate]──► Unlocked (Transferable)
                                              │
                                   ──[Burn Token]──► Burned (attestationHash released)
```

---

### 4.2 Module 2: ERC-4626 Lending Pool

**Core Objective**: Provide standardized, auditable liquidity infrastructure with isolated risk management.

| Feature | Description |
|:---|:---|
| **Factory Deployment** | Each ERC-20 reserve asset can back multiple independent ERC-4626 pools with unique risk settings. |
| **Pool Risk Parameters** | `maxLtvBps`, `liquidationThresholdBps`, `liquidationPenaltyBps`, and `borrowRateBpsPerYear` configure at the pool level. Admins can update them dynamically. |
| **Collateral Eligibility Policy** | Optional `EligibilityPolicy` contract filters allowed collateral by `cardTypeId`. |
| **LP Deposit** | LPs deposit underlying assets (e.g. USDC) and receive pool share tokens (`pToken`). |
| **LP Redeem** | LPs redeem shares for underlying assets subject to available pool liquidity. |
| **Non-Transferable Shares** | `pToken` disables peer-to-peer transfers. Supports only minting on deposit and burning on redeem. |
| **Liquidity Operations** | Only `LoanCore` and `DutchAuction` contracts can call liquidity transfer interfaces. |
| **Interest and Penalty Routing** | Repaid interest and liquidation penalties route directly into the pool to increase share value. |
| **Inflation Attack Protection** | 3-digit virtual share offset prevents first-depositor inflation attacks. |

---

### 4.3 Module 3: Credit Management and Collateral Vaults

**Core Objective**: Manage the credit lifecycle from position opening to closure.

| Feature | Description |
|:---|:---|
| **Create Vault** | KYB-verified merchants create vaults bound to a specific lending pool with an incremental ID. |
| **Deposit Collateral** | Batch deposit NFT cards. Contract locks cards and validates KYB and pool eligibility. |
| **FMV Oracle Update** | Oracle updates card valuations in `CardPriceFeed` by `cardTypeId` (18-decimal precision, single or batch). |
| **Execute Borrow** | Validates KYB and max LTV limit. Transfers stablecoins from pool to borrower wallet via `drawLiquidity`. |
| **Interest Accrual** | Accrues interest before every state transition with `accountedDt` precision compensation. |
| **Process Repayment** | Applies payments to interest first and principal second. Returns funds to pool via `returnLiquidity`. Third parties can repay on behalf of borrowers. |
| **Withdraw Collateral** | Free withdrawal when debt is zero. When debt exists, verifies remaining collateral covers current debt. |
| **Atomic Repay + Withdraw** | Executes repayment and collateral withdrawal in one atomic transaction. |
| **Start Liquidation** | Only `DutchAuction` can transition an active vault to `Liquidating` status when health factor is below 1.0. |
| **Finalize Liquidation** | Only `DutchAuction` can close a liquidating vault, clear remaining debt, and transfer NFTs. |

---

### 4.4 Module 4: Dutch Auction Liquidation Engine

**Core Objective**: Protect protocol solvency through permissionless, market-driven liquidations.

| Feature | Description |
|:---|:---|
| **Start Auction** | Any user can trigger liquidation for a vault with Health Factor $< 1.0$. |
| **Price Decay** | Price decays linearly over 48 hours from 120% FMV to reserve price (Debt + Penalty). |
| **Market Settlement** | Liquidator pays current price. Funds distribute by priority (Debt $\rightarrow$ Penalty $\rightarrow$ Surplus Refund). |
| **Treasury Buyback** | If no buyer purchases within 48 hours, Treasury buys back collateral at exact debt to protect LP capital. |
| **Reentrancy Protection** | All settlement and buyback paths enforce strict reentrancy guards. |
| **Treasury Address Management** | Admins configure and update the non-zero Treasury recipient address. |
| **Pause Mechanism** | Supports emergency pause via `PAUSER_ROLE`. |

**Liquidation Decision Tree**:

```
Vault Health Factor < 1.0
    │
    ▼
Start Auction (Any Caller)
    │
    ├── Buyer purchases within 48h?
    │      │
    │      ├── Yes ──► Market Settlement (settleAuction)
    │      │           ├─ Repay pool debt ✓ (returnLiquidity)
    │      │           ├─ Transfer penalty directly to pool ✓
    │      │           ├─ Refund surplus to borrower ✓
    │      │           └─ Transfer NFTs to liquidator ✓ (finalizeLiquidation)
    │      │
    │      └── No  ──► Auction Expired
    │                  │
    │                  ▼
    │              Treasury Buyback (treasuryBuyback)
    │              ├─ Repay pool debt ✓ (returnLiquidity)
    │              ├─ Penalty waived ✓
    │              └─ Transfer NFTs to Treasury ✓ (finalizeLiquidation)
    │
    └── Across both execution paths:
        LP Principal = Fully Protected at all times ✓
```

---

## 5. High-Level Data Flow

### 5.1 End-to-End Protocol Lifecycle

```
                     HoloFi Protocol Full Lifecycle

  ┌──────────────────┐                                  ┌──────────────────┐
  │  Physical World  │                                  │  On-Chain State  │
  └────────┬─────────┘                                  └────────┬─────────┘
           │                                                     │
 ① Physical Card                                                 │
    Grading & Vaulting ────────────────────────────────► NFT Minting
           │                                             (cardTypeId +
           │                                              attestationHash
           │                                              + tokenURI)
           │                                                     │
           │                                                     ▼
           │                                               ② Create Vault
           │                                                  (Select Pool)
           │                                                  Deposit NFT
           │                                                  (Check Policy)
           │                                                  Oracle Price
           │                                                  (by cardTypeId)
           │                                                     │
           │                                                     ▼
           │              ┌─── LP Deposits Assets ────► Lending Pool ◄───┐
           │              │                               │              │
           │              │                               │ Borrow       │ Repay
           │              │                               ▼              │
           │              │                         ③ Execute Borrow ────┘
           │              │                               │
           │              │                               │ Continuous Interest Accrual
           │              │                               │ (accountedDt Compensation)
           │              │                               │
           │              │                               ▼
           │              │                 ┌───── ④ Regular Repay ──────┐
           │              │                 │      (Interest First)      │
           │              │                 │                            │
           │              │                 ▼                            │ When zero debt
           │              │            Partial Repay                     │
           │              │          (Position Active)                   ▼
           │              │                                        ⑤ Withdraw NFT
           │              │                                           Unlock
           │              │                                              │
 ⑥ Physical Delivery ◄───────────────────────────────────────────────────┘
    Unvault Card
           │
           │          ─── Liquidation Path (FMV drops, Health Factor < 1.0) ───
           │
           │              │                               │
           │              │                               ▼
           │              │                      ⑦ Start Dutch Auction
           │              │                         48h Linear Decay
           │              │                               │
           │              │                  ┌────────────┴────────────┐
           │              │                  │                         │
           │              │           Liquidator Buys               No Bids
           │              │                  │                         │
           │              │                  ▼                         ▼
           │              │           ⑧ Settle Auction          ⑨ Treasury Buyback
           │              │           ├ Repay Debt              ├ Repay Debt
           │              │           ├ Penalty to Pool         ├ Zero Penalty
           │              │           ├ Refund Surplus          └ NFT → Treasury
           │              │           └ NFT → Liquidator
           │              │                  │
           │              └──────────────────┘
           │                         │
           │                         ▼
           │                   LP Capital Safe ✓
           │
           └──────────── Lifecycle Complete
```

---

### 5.2 Phase 1: Onboarding and Minting

```
Physical World               Protocol Boundary                On-Chain
──────────────               ─────────────────                ────────
Card Owner                   Blink Vault                      HoloFi Protocol
    │                             │                                  │
    │  ① Submit Card              │                                  │
    │  (PSA 10, BGS 9.5, etc.)    │                                  │
    ├────────────────────────────►│                                  │
    │                             │  ② Physical Intake & Grading     │
    │                             │  Generate Attestation Payload    │
    │                             │  (Name, Cert#, Grade, Image)     │
    │                             │                                  │
    │                             │  ③ Compute attestationHash       │
    │                             │  H = Keccak256(Proof Data)       │
    │                             │  Compute cardTypeId              │
    │                             │  T = Keccak256(CardAttributes)   │
    │                             │                                  │
    │                             │  ④ Register Card Type            │
    │                             │  (EligibilityPolicy.             │
    │                             │   registerCardType)              │
    │                             │                                  │
    │                             │  ⑤ Call mintCard                 │
    │                             ├─────────────────────────────────►│
    │                             │  (to, cardTypeId,                │
    │                             │   attestationHash, tokenURI)     │
    │                             │                                  │
    │                             │                     ⑥ Mint NFT   │
    │                             │                     Store Data   │
    │                             │                     Verify Hash  │
    │                             │                                  │
    │  ⑦ Receive NFT Voucher      │◄─────────────────────────────────│
    │  (On-chain title voucher    │                                  │
    │   for the physical card)    │                                  │
    │                             │                                  │
```

**Key Verification Rules**:
- The minter must hold `MINTER_ROLE` or `ADMIN_ROLE`.
- The recipient address cannot be the zero address.
- The `cardTypeId` cannot be empty (`bytes32(0)`).
- The `attestationHash` cannot be empty and must be globally unique.
- After minting, any caller can submit raw attestation data to `verifyAttestation` to confirm authenticity.

---

### 5.3 Phase 2: Borrowing and Interest Accrual

```
Merchant (KYB Verified)       Loan Core              Lending Pool          Oracle
───────────────────────       ─────────              ────────────          ──────
    │                             │                       │                  │
    │  ① Create Vault             │                       │                  │
    │  (Select Lending Pool)      │                       │                  │
    ├────────────────────────────►│                       │                  │
    │  (Verify KYB ✓)             │                       │                  │
    │  (Verify Pool Validity ✓)   │                       │                  │
    │  ◄── Return Vault ID ───────│                       │                  │
    │                             │                       │                  │
    │  ② Deposit NFT Collateral   │                       │                  │
    ├────────────────────────────►│                       │                  │
    │  (Transfer NFT to custody,  │                       │                  │
    │   LOCKER_ROLE locks NFT,    │                       │                  │
    │   Verify eligibility policy)│                       │                  │
    │                             │                       │                  │
    │                             │  ③ Oracle Price Feed  │                  │
    │                             │  (Update FMV by       │                  │
    │                             │   cardTypeId)         │                  │
    │                             │                       │                  │
    │                             │                       │        ──────────│
    │                             │                       │        PriceFeed │
    │                             │                       │        setPrice  │
    │                             │                       │        ──────────│
    │                             │                       │                  │
    │  ④ Submit Borrow Request    │                       │                  │
    │  (Amount)                   │                       │                  │
    ├────────────────────────────►│                       │                  │
    │                             │                       │                  │
    │                             │  ⑤ Validation Flow:   │                  │
    │                             │  ├ Verify KYB ✓       │                  │
    │                             │  ├ Check Ownership ✓  │                  │
    │                             │  ├ Confirm Active ✓   │                  │
    │                             │  ├ Accrue Interest ✓  │                  │
    │                             │  ├ Sum FMV (18 dec)   │                  │
    │                             │  │ (Query PriceFeed)  │                  │
    │                             │  ├ Max Capacity:      │                  │
    │                             │  │ normalizeToAsset(  │                  │
    │                             │  │ FMV×LTV÷10000)     │                  │
    │                             │  └ Total Debt ≤ Cap ✓ │                  │
    │                             │                       │                  │
    │                             │  ⑥ drawLiquidity      │                  │
    │                             ├──────────────────────►│                  │
    │                             │                       │  Transfer funds  │
    │  ⑦ Receive Borrowed Funds   │                       │  to merchant     │
    │◄────────────────────────────────────────────────────│                  │
    │                             │                       │                  │
    │      ┌──────────────────────┤                       │                  │
    │      │ ⑧ Ongoing Accrual    │                       │                  │
    │      │ Accrue on every call │                       │                  │
    │      │ I = P × R × Δt       │                       │                  │
    │      │   ÷ (10000 × 365d)   │                       │                  │
    │      │ accountedDt comp.    │                       │                  │
    │      └──────────────────────┤                       │                  │
    │                             │                       │                  │
    │  ⑨ Repay (Partial / Full)   │                       │                  │
    ├────────────────────────────►│                       │                  │
    │                             │  ⑩ Repay Logic:       │                  │
    │                             │  ├ Pay accrued int.   │                  │
    │                             │  └ Reduce principal   │                  │
    │                             │                       │                  │
    │                             │  ⑪ returnLiquidity    │                  │
    │                             ├──────────────────────►│                  │
    │                             │  (Transfer to pool)   │                  │
    │                             │                       │                  │
```

**Key Business Rules**:
1. Borrow amount must be greater than zero.
2. Total debt after borrowing must not exceed the maximum borrow capacity calculated from current normalized FMV.
3. The contract accrues interest before every state transition and applies `accountedDt` compensation to avoid truncation loss.
4. When repaying, the contract caps the payment at total outstanding debt.
5. Only the vault owner can borrow funds or withdraw collateral, and the owner must maintain valid KYB status.
6. Any third party can execute repayments on behalf of the borrower.

---

### 5.4 Phase 3: Liquidation and Settlement

```
Any Caller          Dutch Auction        Loan Core        Lending Pool       Treasury
──────────          ─────────────        ─────────        ────────────       ────────
    │                     │                  │                 │                │
    │  ① Start Auction    │                  │                 │                │
    │  (Vault ID)         │                  │                 │                │
    ├────────────────────►│                  │                 │                │
    │                     │                  │                 │                │
    │                     │  ② startLiquidation                │                │
    │                     ├─────────────────►│                 │                │
    │                     │                  │  ③ Validate:    │                │
    │                     │                  │  ├ Vault Active │                │
    │                     │                  │  ├ Accrue Int.  │                │
    │                     │                  │  ├ Compute HF   │                │
    │                     │                  │  │ (norm. FMV)  │                │
    │                     │                  │  └ HF < 1.0 ✓   │                │
    │                     │                  │                 │                │
    │                     │                  │  ④ Set Status   │                │
    │                     │                  │  Active → Liq.  │                │
    │                     │                  │                 │                │
    │                     │  ⑤ Record Auction│                 │                │
    │                     │  Read Pool Params│                 │                │
    │                     │  FMV → normAsset │                 │                │
    │                     │  Start = max(    │                 │                │
    │                     │    FMV×120%,     │                 │                │
    │                     │    ReservePrice) │                 │                │
    │                     │  Reserve = Debt +│                 │                │
    │                     │    Debt×Penalty  │                 │                │
    │                     │  Duration = 48h  │                 │                │
    │                     │                  │                 │                │
    │                     │                  │                 │                │
    │     ════════════════╪══ Auction Active ╪═════════════════╪════════════════│
    │                     │                  │                 │                │
    │                     │  Linear Decay:   │                 │                │
    │                     │  P(t) = Start -  │                 │                │
    │                     │  (Start-Reserve) │                 │                │
    │                     │  × t ÷ 48h       │                 │                │
    │                     │                  │                 │                │
    │     ─── Path A: Market Settlement (Within 48h) ───────────────────────────│
    │                     │                  │                 │                │
Liquidator                │                  │                 │                │
    │  ⑥ settleAuction   │                  │                 │                │
    ├────────────────────►│                  │                 │                │
    │                     │  ⑦ Receive Price │                 │                │
    │  Transfer Funds ────►│                  │                 │                │
    │                     │                  │                 │                │
    │                     │  ⑧ returnLiquidity (Debt)          │                │
    │                     ├──────────────────────────────────►│                │
    │                     │  (principalPaid + totalAmount)     │                │
    │                     │                  │                 │                │
    │                     │  ⑨ Transfer Penalty                │                │
    │                     ├──────────────────────────────────►│                │
    │                     │  (safeTransfer)  │                 │  Boost LP Yield│
    │                     │                  │                 │                │
    │                     │  ⑩ Refund Surplus│                 │                │
    │                     ├──► Original Owner│                 │                │
    │                     │  (Price-Reserve) │                 │                │
    │                     │                  │                 │                │
    │                     │  ⑪ finalizeLiquidation             │                │
    │                     ├─────────────────►│                 │                │
    │                     │                  │ ⑫ Clear Debt    │                │
    │                     │                  │ Status → Closed │                │
    │                     │                  │ Unlock all NFTs │                │
    │                     │                  │ NFT → Liquidator│                │
    │                     │                  │                 │                │
    │     ─── Path B: Treasury Buyback (After 48h with No Bids) ────────────────│
    │                     │                  │                 │                │
    │                     │                  │                 │         ⑬ Buyback
    │                     │◄────────────────────────────────────────────────────│
    │                     │ (treasuryBuyback)│                 │                │
    │                     │                  │                 │                │
    │                     │  ⑭ Validate:     │                 │                │
    │                     │  ├ Treasury only │                 │                │
    │                     │  ├ Not settled   │                 │                │
    │                     │  └ Elapsed > 48h │                 │                │
    │                     │                  │                 │                │
    │                     │  ⑮ Receive Debt Amount             │                │
    │                     │  (Zero Penalty) ◄───────────────────────────────────│
    │                     │                  │                 │                │
    │                     │  ⑯ returnLiquidity (Debt)          │                │
    │                     ├──────────────────────────────────►│                │
    │                     │                  │                 │  LP Capital Safe
    │                     │                  │                 │                │
    │                     │  ⑰ finalizeLiquidation             │                │
    │                     ├─────────────────►│                 │                │
    │                     │                  │ ⑱ Clear Debt    │                │
    │                     │                  │ Status → Closed │                │
    │                     │                  │ Unlock all NFTs │                │
    │                     │                  │ NFT → Treasury  │                │
```

---

### 5.5 Formula Reference Cheatsheet

| Formula Name | Mathematical Expression | Description |
|:---|:---|:---|
| **Max Borrow Capacity** | $\text{normalizeToAsset}(\text{FMV}_{18} \times \text{maxLtvBps} \div 10,000)$ | Reads `maxLtvBps` from pool; scales FMV via `DecimalMath` |
| **Linear Interest** | $\text{Principal} \times \text{borrowRate} \times \Delta t \div (10,000 \times 31,536,000)$ | Reads `borrowRate` from pool; $\Delta t$ is in seconds |
| **Precision Compensation** | $\text{accountedDt} = \lceil\text{interestNew} \times \text{BPS} \times \text{SECONDS\_PER\_YEAR} \div (\text{principal} \times \text{borrowRate})\rceil$ | Prevents truncation error accumulation |
| **Total Debt** | $\text{Principal} + \text{Accrued Interest} + \text{Pending Interest}$ | Computes pending interest in real time |
| **Health Factor** | $\text{normalizedFmv} \times \text{liquidationThresholdBps} \times 10^{18} \div (\text{Total Debt} \times 10,000)$ | Reads threshold from pool; $< 10^{18}$ triggers liquidation |
| **Liquidation Penalty** | $\text{Total Debt} \times \text{liquidationPenaltyBps} \div 10,000$ | Reads penalty rate from pool |
| **Auction Reserve Price** | $\text{Total Debt} + \text{Liquidation Penalty}$ | Minimum settlement price for liquidators |
| **Auction Start Price** | $\max(\text{normalizedFmv} \times 12,000 \div 10,000, \text{Reserve Price})$ | Start price cannot fall below reserve price |
| **Current Auction Price** | $\text{Start Price} - (\text{Start Price} - \text{Reserve Price}) \times \text{Elapsed Time} \div \text{Duration}$ | Linear decay over 48 hours; equals reserve price after 48h |
| **Surplus Refund** | $\text{Settlement Price} - \text{Reserve Price}$ | Returns excess proceeds to the original vault owner |

---

> [!CAUTION]
> This whitepaper reflects the codebase implementation (Solidity 0.8.28 / OpenZeppelin 5.x / Hardhat 3) at the time of writing. The protocol configures risk parameters (LTV, borrow rate, liquidation penalty) independently per lending pool. Admins can update these parameters dynamically via `setRiskParameters`. Actual deployed values may differ from the defaults documented in this specification.
