# HoloFi Protocol V1

## 1. System Vision & Architectural Decoupling

**HoloFi** is an on-chain B2B Real-World Asset (RWA) financing infrastructure designed for Trading Card Game (TCG: Pokémon, Magic: The Gathering, Yu-Gi-Oh!) boutiques and merchants. The system enforces a strict separation of concerns between physical custody and the on-chain credit engine:

1. **Physical Logistics & Vaulting**: 100% delegated to certified partner **Blink**, which handles physical card reception, grading authentication, secure vaulting, and physical delivery upon redemption.


2. **On-Chain Register & Credit Engine**: Powered by smart contracts on EVM-compatible blockchains. HoloFi manages a single, permissioned NFT collection (`HoloFiCardCollection`), boutique-isolated collateral vaults (`CollateralVault`), a shared liquidity pool (`ERC-4626`), an oracle valuation pipeline (`Chainlink CRE` + `FMV Engine`), and a Dutch Auction liquidation mechanism.



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
│  │  HoloFiCardCollection      │         │   HoloFiVaultLoanCore   │         │  HoloFiLendingVault      │   │
│  │ (Single Global Coll.)  │◄───────►│   (Collateral Vaults)   │◄───────►│  (ERC-4626 USDC Pool)    │   │
│  └────────────────────────┘         └────────────┬────────────┘         └──────────────────────────┘   │
│                                                  │                                                     │
│                                                  │ Trigger Liquidation                                 │
│                                                  ▼                                                     │
│                                     ┌─────────────────────────┐                                        │
│                                     │  HoloFiDutchAuction     │                                        │
│                                     │  (Vault Liquidation)    │                                        │
│                                     └─────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘

```

---

## 3. Detailed Technical Module Specifications

### 3.1. Unified Ownership Registry: `HoloFiCardCollection`

All vaulted TCG cards across all boutiques are minted within a **single, unified ERC-721 Collection** (`HoloFi Vaulted TCG Collection`).

* **Transfer Restrictions (Permissioned ERC-721)**:
To prevent collateral escape and enforce KYB/AML compliance, `transferFrom` and `safeTransferFrom` functions are overridden. NFTs can **only** be transferred between verified boutique wallets, the `HoloFiVaultLoanCore` contract, or the `HoloFiDutchAuction` contract.


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

Manages isolated `CollateralVault` accounting for each boutique.

#### A. Core Data Structures

```solidity
enum VaultStatus { Active, Liquidating, Closed }

struct CollateralVault {
    uint256 vaultId;
    address owner;                  // Boutique wallet address
    uint256[] tokenIds;             // List of deposited NFT token IDs (from global collection)
    uint256 principalDebt;          // Borrowed capital (USDC)
    uint256 accumulatedInterest;    // Unpaid accrued interest
    uint256 lastInterestUpdate;     // Timestamp of last interest calculation
    VaultStatus status;
}

mapping(uint256 => CollateralVault) public vaults;
uint256 public baseLtvBps = 5000;   // Base LTV: 50.00% (expressed in Basis Points)
uint256 public liquidationThresholdBps = 7000; // Liquidation Threshold: 70.00%

```

#### B. Accounting Mechanics & Card Movement Controls

* **Continuous Interest Calculation**:

$$\Delta t = \text{block.timestamp} - \text{lastInterestUpdate}$$


$$\text{Interest}_{\text{new}} = \text{principalDebt} \times \text{BorrowRate} \times \frac{\Delta t}{365 \text{ days}}$$


$$\text{accumulatedInterest} \leftarrow \text{accumulatedInterest} + \text{Interest}_{\text{new}}$$


* **Max Borrow Capacity**:

$$\text{MaxBorrow} = \text{payload.totalFmv} \times \frac{\text{baseLtvBps}}{10000}$$


* **Card Deposit (`depositCollateral`)**:
Boutiques can add NFTs to their vault at any time, increasing `totalFmv` and credit limit without requiring immediate borrow execution.
* **Card Withdrawal (`withdrawCollateral`)**:
Boutiques can remove specific NFTs if and only if the remaining FMV satisfies the safety assertion:

$$\text{Total Debt} \le (\text{payload.totalFmv} - \text{FMV}(\text{withdrawnTokens})) \times \frac{\text{baseLtvBps}}{10000}$$



If this assertion fails, the transaction reverts with `InsufficientCollateralRatio()`.

---

### 3.4. Shared Liquidity Pool: `HoloFiLendingVault` (ERC-4626)

Manages liquidity provided by Liquidity Providers (LPs) in USDC/EURC.

* **Standard ERC-4626 & Permissioned Extension**:
* `deposit`, `mint`, `withdraw`, and `redeem` verify the caller's KYB status in `AccessControlManager`.


* Issued share tokens (`vUSDC`) are non-transferable (`transfer` and `transferFrom` calls revert).




* **Illiquidity Gate**:
When a boutique borrows USDC, `LoanCore` requests funds via `LendingVault.transferFunds()`. If available free liquidity is insufficient:

$$\text{USDC}_{\text{available}} = \text{Balance}_{\text{USDC}} - \text{TotalBorrowed}$$



The contract throws `InsufficientVaultLiquidity()` and reverts the transaction.



---

### 3.5. Liquidation Engine: `HoloFiDutchAuction`

Activated when a boutique vault's Health Factor ($HF$) falls below 1.0:


$$HF = \frac{\text{payload.totalFmv} \times \text{liquidationThresholdBps}}{\text{principalDebt} + \text{accumulatedInterest}} < 1.0$$

#### A. Dutch Auction Parameters

1. **State Locking**: The target vault enters `Liquidating` status. Associated NFTs are transferred to `HoloFiDutchAuction`. The boutique cannot borrow, repay, or withdraw assets.


2. **Price Decay Function**:
* **Start Price ($P_{\text{start}}$)**: $\text{payload.totalFmv} \times 120\%$
* **Reserve Price ($P_{\text{reserve}}$)**: $\text{TotalDebt} + \text{LiquidationFee}$
* **Auction Duration ($T_{\text{auction}}$)**: 48 to 72 hours.


$$\text{CurrentPrice}(t) = P_{\text{start}} - \left( (P_{\text{start}} - P_{\text{reserve}}) \times \frac{t - t_{\text{start}}}{T_{\text{auction}}} \right)$$



#### B. Auction Settlement (`bidAuction`)

When a liquidator calls `bidAuction(vaultId)` paying $\text{CurrentPrice}(t)$ in USDC:

```text
Liquidator Buyer
    │
    │ 1. Pays CurrentPrice(t) in USDC
    ▼
HoloFiDutchAuction Contract
    │
    ├───► 2. Transfer Debt Amount ──────────────► HoloFiLendingVault (ERC-4626)
    │                                             (Full Principal + Interest Clearance)
    │
    ├───► 3. Transfer Liquidation Fee ─────────► Protocol Fee Receiver
    │
    ├───► 4. Transfer Surplus (If any) ────────► Original Boutique (Vault Owner)
    │
    └───► 5. On-Chain Transfer NFTs ───────────► Liquidator Address
                                                  │
                                                  └─► Emit Event AuctionSettled
                                                       │
                                                       ▼
                                                 Blink System (Sync Physical Ownership)

```

---

## 4. Sequence Diagrams

### 4.1. Boutique Borrow Sequence

```text
Boutique            Front-End / CRE           LoanCore Contract       ERC-4626 Vault
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
* `KYB_MANAGER_ROLE`: Authorized to grant or revoke KYB whitelisted status for boutiques and LPs.

### 5.2. Smart Contract Mitigations

1. **Reentrancy Protection**: Strict enforcement of *Checks-Effects-Interactions* (CEI) pattern and mandatory `nonReentrant` modifiers on all token-transferring entry points (`borrow`, `repay`, `withdrawCollateral`, `bidAuction`).
2. **Replay Attack Protection**: Mandatory inclusion of `chainId`, `verifyingContract`, incremental `nonce`, and expiration timestamps within the EIP-712 domain struct.
3. **ERC-4626 Inflation Attack Protection**: Leverages OpenZeppelin’s virtual shares implementation (offset) to neutralize donation-based exchange-rate manipulation attacks.
