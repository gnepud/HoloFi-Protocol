# HoloFi Protocol Hardhat Ignition Deployment Guide

This guide details the step-by-step procedure to deploy the HoloFi smart contract suite across local development networks (`localhost`), testnets (Sepolia, Base Sepolia), and mainnets using **Hardhat Ignition**.

---

## 1. Deployment Architecture & Pipeline Sequence

The HoloFi protocol deployment is orchestrated deterministically via Hardhat Ignition modules located under `ignition/modules/`.

```
1. AccessControlManager (ACM)         ──► Core access control hub
2. HoloFiVaultCard (vaultCard)        ──► ERC-721 Vault NFT contract
3. HoloFiCardPriceFeed (priceFeed)    ──► Oracle price feed registry
4. HoloFiLendingPoolFactory           ──► Pool factory instance
5. HoloFiVaultLoanCore (loanCore)     ──► Core credit & vault manager
6. HoloFiDutchAuction (dutchAuction)  ──► Open-market liquidation engine
7. [Optional] GradeEligibilityPolicy  ──► Grader and integer grade filter policy
8. [Optional] HoloFiLendingPool       ──► ERC-4626 liquidity pool instances (Premium & Deluxe)
```

---

## 2. Deployment Scenarios & Commands

### Scenario A: Local Development Quickstart (Full Protocol + Mock Token + 1,000,000 EURC Liquidity)

For local development or testing (`localhost`), run the composite module. This automatically deploys the 6 core contracts, deploys a `MockERC20` (6 decimals), creates the `HoloFiLendingPool`, wires up all contract references/roles, and pre-funds the pool with **1,000,000 EURC** liquidity:

```bash
npx hardhat ignition deploy ignition/modules/DeployHoloFiFullProtocol.ts --network localhost
```

---

### Scenario B: Custom Parameterized Deployment (Mock Token)

To customize operational role addresses (`oracleFeeder`, `minter`, `treasury`) or liquidity amounts, create a parameter configuration file:

`ignition/parameters.json`:
```json
{
  "DeployHoloFiProtocol": {
    "oracleFeeder": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "minter": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "treasury": "0x90F79bf6EB2c4f809663852283088995309d4123"
  },
  "DeployHoloFiLendingPoolWithMock": {
    "mockMintAmount": "5000000000000",
    "poolName": "Pool EURC",
    "poolSymbol": "pEURC",
    "maxLtvBps": "5000",
    "liquidationThresholdBps": "7000",
    "liquidationPenaltyBps": "1000",
    "borrowRateBpsPerYear": "500"
  }
}
```

Execute with `--parameters`:
```bash
npx hardhat ignition deploy ignition/modules/DeployHoloFiFullProtocol.ts --parameters ignition/parameters.json --network localhost
```

---

### Scenario C: Deployment to Testnet / Mainnet with Existing Live ERC-20 Token

When deploying to a public network (e.g. Sepolia, Base Sepolia) where a live ERC-20 token contract already exists (e.g., Circle EURC address):

1. Create parameter file referencing the live token address:

`ignition/parameters.json`:
```json
{
  "DeployHoloFiProtocol": {
    "oracleFeeder": "<ORACLE_FEEDER_WALLET_ADDRESS>",
    "minter": "<MINTER_WALLET_ADDRESS>",
    "treasury": "<TREASURY_WALLET_ADDRESS>"
  },
  "DeployHoloFiLendingPool": {
    "existingAssetAddress": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "poolName": "HoloFi EURC Pool",
    "poolSymbol": "pEURC",
    "maxLtvBps": "5000",
    "liquidationThresholdBps": "7000",
    "liquidationPenaltyBps": "1000",
    "borrowRateBpsPerYear": "500"
  }
}
```

2. Execute deployment for the existing ERC20 pool module:
```bash
npx hardhat ignition deploy ignition/modules/DeployHoloFiLendingPool.ts --parameters ignition/parameters.json --network sepolia
```

---

### Scenario D: Core Protocol Only (No Initial Lending Pool)

If you only wish to deploy core infrastructure without deploying an initial lending pool:

```bash
npx hardhat ignition deploy ignition/modules/DeployHoloFiProtocol.ts --network localhost
```

---

## 3. Automated Post-Deployment Verification

The automated verification test suite verifies contract interconnectivity state getters, role authorizations via ACM, and end-to-end collateral deposit flows:

```bash
npx hardhat build && npx tsc --noEmit && npx hardhat test
```

---

## 4. Role & KYC/KYB Permissions Management (`scripts/manage-roles.ts`)

The HoloFi protocol includes an operator CLI tool located at [`scripts/manage-roles.ts`](../scripts/manage-roles.ts) to inspect, grant, and revoke protocol roles as well as manage merchant store KYC/KYB compliance status on `AccessControlManager.sol`.

### Command Syntax

#### Method A: Direct CLI Execution (Recommended)
```bash
npm run roles <action> <target_address> [role_name | status] [acm_address] [--network <network>]
# or
npx tsx scripts/manage-roles.ts <action> <target_address> [role_name | status] [acm_address] [--network <network>]
```

#### Method B: Hardhat Run with Environment Variables
```bash
ACTION=<action> ACCOUNT=<target_address> [ROLE=<role_name>] [STATUS=<status>] npx hardhat run scripts/manage-roles.ts --network <network>
```

### Supported Actions

| Action | Description | Example |
| :--- | :--- | :--- |
| `check` / `list` / `view` | Inspect all role assignments and KYB status for an address | `npm run roles check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| `grant` / `add` | Grant a role to the target address | `npm run roles grant 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 ORACLE_ROLE` |
| `revoke` / `remove` | Revoke a role from the target address | `npm run roles revoke 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 minter` |
| `kyb` / `kyc` / `set-kyb` | Set KYC/KYB compliance approval status for target address | `npm run roles kyb 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 approve` |

### Address Resolution Precedence

The script automatically detects the `AccessControlManager` contract address in the following order:
1. **Positional / Flag Argument**: Pass ACM address directly via CLI argument or `--acm <address>`.
2. **Environment Variable**: `ACM_ADDRESS` or `ACCESS_CONTROL_MANAGER_ADDRESS`.
3. **Ignition Deployments**: Auto-discovered from `ignition/deployments/chain-<chainId>/deployed_addresses.json` or root `deployed_addresses.json`.

### Supported Roles & Case-Insensitive Aliases

| Canonical Role Name | Supported Aliases | Role Description |
| :--- | :--- | :--- |
| `DEFAULT_ADMIN_ROLE` | `root`, `zero`, `default_admin`, `0x000...` | Root admin capable of assigning any role |
| `ADMIN_ROLE` | `admin`, `ADMIN` | Protocol parameter administration |
| `ORACLE_ROLE` | `oracle`, `feeder`, `price_feeder` | Updates card Fair Market Values (FMVs) in PriceFeed |
| `MINTER_ROLE` | `minter`, `MINTER` | Mints and locks Vault Card NFTs |
| `KYB_MANAGER_ROLE` | `kyb`, `kyb_manager` | Authorizes merchant stores via KYB approval |
| `PAUSER_ROLE` | `pauser`, `PAUSER` | Circuit breaker pause operator |
| `<bytes32 hex>` | `0x...` | Any raw 32-byte role identifier hash |

### Supported KYC/KYB Status Values & Aliases

| Desired Status | Accepted Values / Aliases (case-insensitive) |
| :--- | :--- |
| **Approved / Enabled (`true`)** | `true`, `1`, `approve`, `approved`, `pass`, `yes`, `enable` |
| **Revoked / Disabled (`false`)** | `false`, `0`, `revoke`, `revoked`, `reject`, `rejected`, `no`, `disable` |

### Operator Examples

#### 1. Inspect Role Status
```bash
npm run roles check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
# or with Hardhat run:
ACTION=check ACCOUNT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 npx hardhat run scripts/manage-roles.ts --network localhost
```

Output:
```text
================================================================================
                       HoloFi AccessControlManager Status                       
================================================================================
Target Address : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
ACM Address    : 0x5FbDB2315678afecb367f032d93F642f64180aa3
KYB Approved   : YES [APPROVED]
--------------------------------------------------------------------------------
ROLE NAME               | ROLE HASH                                    | STATUS
------------------------+----------------------------------------------+----------
DEFAULT_ADMIN_ROLE      | 0x0000000000000000000000000000000000000000...| [GRANTED]
ADMIN_ROLE              | 0xa49807205ce4d355092ef5a8a18f56e8913cf4a2...| [GRANTED]
ORACLE_ROLE             | 0x8df622c366632f056d68636eb623e1bed4020c6a...| [NOT GRANTED]
MINTER_ROLE             | 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8...| [NOT GRANTED]
KYB_MANAGER_ROLE        | 0x6e2df1b9ecf16f5c0938ff7b715694a974b971a8...| [NOT GRANTED]
PAUSER_ROLE             | 0x65d78846734c5e962901ac9b426d21f5f49e242a...| [NOT GRANTED]
================================================================================
```

#### 2. Grant Oracle Role to Feeder Wallet
```bash
npm run roles grant 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 oracle
```

#### 3. Revoke Minter Role
```bash
npm run roles revoke 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 minter
```

#### 4. Approve Merchant KYC/KYB Status
```bash
npm run roles kyb 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 approve
# or with kyc alias:
npm run roles kyc 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 enable
```

#### 5. Revoke Merchant KYC/KYB Status
```bash
npm run roles kyb 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 reject
# or
npm run roles kyc 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 revoke
```

#### 6. Specify Custom ACM Address on Testnet
```bash
npm run roles -- check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0xA4a75B3f3e957222E0d67Ea8b643F137BDFCe03B --network baseSepolia
# or using npx tsx directly:
npx tsx scripts/manage-roles.ts check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --network baseSepolia
# or using environment variable:
HARDHAT_NETWORK=baseSepolia npm run roles check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

> [!NOTE]
> When passing `--network` or any option flag starting with `--` through `npm run`, npm requires a double dash `--` separator before the arguments (e.g. `npm run roles -- check <addr> --network baseSepolia`). Alternatively, use `npx tsx scripts/manage-roles.ts` or set `HARDHAT_NETWORK=<network>`.

---

## 5. Vault Card NFT Details Viewer (`scripts/view-card.ts`)

The HoloFi protocol includes a dedicated NFT inspection CLI tool located at [`scripts/view-card.ts`](../scripts/view-card.ts) to query on-chain card attributes, physical vault attestation hashes, collateral lock status, escrow/vault owner metadata, and real-time Oracle Fair Market Value (FMV) valuations for any `HoloFiVaultCard` by token ID.

### Command Syntax

#### Method A: Direct CLI Execution (Recommended)
```bash
npm run view-card <tokenId> [vaultCardAddress] [options]
# or
npx tsx scripts/view-card.ts <tokenId> [vaultCardAddress] [options]
```

#### Method B: Hardhat Run with Environment Variables
```bash
TOKEN_ID=<tokenId> [VAULT_CARD_ADDRESS=<address>] [PRICE_FEED_ADDRESS=<address>] [LOAN_CORE_ADDRESS=<address>] npx hardhat run scripts/view-card.ts --network <network>
```

### CLI Arguments & Options

| Argument / Flag | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `<tokenId>` | Positional / Required | Token ID of the vault card NFT | `npm run view-card 1` |
| `[vaultCardAddress]` | Positional / Optional | Address of the `HoloFiVaultCard` contract | `npm run view-card 1 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| `--contract`, `-c` | Option Flag | Specify `HoloFiVaultCard` contract address | `--contract 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| `--price-feed`, `-p` | Option Flag | Specify `HoloFiCardPriceFeed` contract address | `--price-feed 0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `--loan-core`, `-l` | Option Flag | Specify `HoloFiVaultLoanCore` contract address | `--loan-core 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| `--network`, `-n` | Option Flag | Target RPC network (default: `localhost`) | `--network sepolia` |
| `--help`, `-h` | Option Flag | Display usage information and examples | `npm run view-card --help` |

### Address Resolution Precedence

The script resolves `HoloFiVaultCard`, `HoloFiCardPriceFeed`, and `HoloFiVaultLoanCore` addresses automatically using the following hierarchy:

1. **CLI Arguments & Flags**: Direct positional arguments or `--contract` / `--price-feed` / `--loan-core` flags.
2. **Environment Variables**: `VAULT_CARD_ADDRESS` (or `CARD_ADDRESS`, `CONTRACT_ADDRESS`), `PRICE_FEED_ADDRESS` (or `FEED_ADDRESS`), and `LOAN_CORE_ADDRESS` (or `VAULT_LOAN_CORE_ADDRESS`).
3. **Ignition Deployments**: Auto-discovered from `ignition/deployments/chain-<chainId>/deployed_addresses.json` or root `deployed_addresses.json`.

### Operator Examples

#### 1. Inspect Token ID #1 (Auto-Resolved Contracts, Unlocked Card)
```bash
npm run view-card 1
```

Output:
```text
================================================================================
                         HoloFi Vault Card NFT Metadata                         
================================================================================
Token ID           : 1
Contract           : 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 (HoloFi TCG Cards - HFC)
Owner Address      : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Lock Status        : UNLOCKED [Free / Transferable]
Minted At          : 2026-08-16T12:00:00.000Z (Unix: 1786881600)
Token URI          : ipfs://QmZtmD2qt8fJpq3CLDHheZAs6GLbmGL5Ux85GYxs9L83vW
--------------------------------------------------------------------------------
ASSET & ATTESTATION DETAILS
--------------------------------------------------------------------------------
Card Type ID       : 0x8b329f6b92a543f9a7217983c27e8a946cb32cf39db99c855a8264e107db32d3
Attestation Hash   : 0x3d49f60e909a39f6044a30a109787ff8c5120689b9101b0f5ef22dcf1e70e28f
--------------------------------------------------------------------------------
ORACLE VALUATION (FMV)
--------------------------------------------------------------------------------
Price Feed         : 0x5FbDB2315678afecb367f032d93F642f64180aa3
Fair Market Value  : $2,000.00 USD (2000.0 USD)
Last Updated       : 2026-08-16T12:05:00.000Z (Unix: 1786881900)
================================================================================
```

#### 2. Query Locked Card in Loan Core Vault
```bash
npm run view-card 2
```

Output:
```text
================================================================================
                         HoloFi Vault Card NFT Metadata                         
================================================================================
Token ID           : 2
Contract           : 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 (HoloFi TCG Cards - HFC)
Owner Address      : 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
Lock Status        : LOCKED [In Escrow / Collateralized]
Locked in Vault    : Vault #1 (Status: Active)
Vault Owner (Store): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Loan Core Escrow   : 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
Minted At          : 2026-08-16T12:00:00.000Z (Unix: 1786881600)
Token URI          : ipfs://QmZtmD2qt8fJpq3CLDHheZAs6GLbmGL5Ux85GYxs9L83vW
--------------------------------------------------------------------------------
ASSET & ATTESTATION DETAILS
--------------------------------------------------------------------------------
Card Type ID       : 0x8b329f6b92a543f9a7217983c27e8a946cb32cf39db99c855a8264e107db32d3
Attestation Hash   : 0x3d49f60e909a39f6044a30a109787ff8c5120689b9101b0f5ef22dcf1e70e28f
--------------------------------------------------------------------------------
ORACLE VALUATION (FMV)
--------------------------------------------------------------------------------
Price Feed         : 0x5FbDB2315678afecb367f032d93F642f64180aa3
Fair Market Value  : $3,500.00 USD (3500.0 USD)
Last Updated       : 2026-08-16T12:05:00.000Z (Unix: 1786881900)
================================================================================
```

#### 3. Inspect Card on Base Sepolia / Sepolia Testnet
```bash
npm run view-card -- 1 --network baseSepolia
# or using npx tsx:
npx tsx scripts/view-card.ts 1 --network baseSepolia
# or using environment variable:
HARDHAT_NETWORK=baseSepolia npm run view-card 1
```

#### 4. Explicit Contract, Price Feed, and Loan Core Addresses
```bash
npm run view-card -- 1 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 --price-feed 0x5FbDB2315678afecb367f032d93F642f64180aa3 --loan-core 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

#### 5. Hardhat Runner Execution
```bash
TOKEN_ID=1 npx hardhat run scripts/view-card.ts --network localhost
```

---

## 6. Mock ERC20 Token Minting (`scripts/mint-mock-token.ts`)

The HoloFi protocol includes a dedicated testing and operator CLI tool located at [`scripts/mint-mock-token.ts`](../scripts/mint-mock-token.ts) to mint `MockERC20` test tokens (e.g., Mock EURC with 6 decimals) to any specified wallet address and inspect balances across local development environments and testnets.

### Command Syntax

#### Method A: Direct CLI Execution (Recommended)
```bash
npm run mint-mock-token -- [action] <recipient_address> [amount] [token_address] [options]
# or
npx tsx scripts/mint-mock-token.ts [action] <recipient_address> [amount] [token_address] [options]
```

#### Method B: Hardhat Run with Environment Variables
```bash
[ACTION=<action>] ACCOUNT=<recipient_address> [AMOUNT=<amount>] [MOCK_ERC20_ADDRESS=<address>] npx hardhat run scripts/mint-mock-token.ts --network <network>
```

### Supported Actions

| Action | Description | Example |
| :--- | :--- | :--- |
| `mint` / `add` (default) | Mint tokens to recipient address (default amount: `10000`) | `npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| `balance` / `check` / `view` | Inspect token balance for target address | `npm run mint-mock-token balance 0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

### CLI Arguments & Options

| Argument / Flag | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `<recipient_address>` | Positional / Required | Target recipient or account address | `npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| `[amount]` | Positional / Optional | Human-readable token amount to mint (default: `10000`) | `npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 50000` |
| `[token_address]` | Positional / Optional | Address of the `MockERC20` contract | `npm run mint-mock-token 0x7099... 1000 0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `--token`, `-t`, `--contract`, `-c` | Option Flag | Specify `MockERC20` contract address | `--token 0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `--amount`, `-a` | Option Flag | Specify token amount to mint | `--amount 25000` |
| `--network`, `-n` | Option Flag | Target RPC network (default: `localhost`) | `--network baseSepolia` |
| `--help`, `-h` | Option Flag | Display usage instructions and examples | `npm run mint-mock-token --help` |

### Address Resolution Precedence

The script automatically detects the `MockERC20` contract address in the following order:

1. **Positional / Flag Argument**: Pass token address directly via CLI argument or `--token <address>`.
2. **Environment Variable**: `MOCK_ERC20_ADDRESS`, `TOKEN_ADDRESS`, `MOCK_TOKEN_ADDRESS`, or `CONTRACT_ADDRESS`.
3. **Ignition Deployments**: Auto-discovered from `ignition/deployments/chain-<chainId>/deployed_addresses.json` (e.g. `DeployHoloFiLendingPoolWithMock#MockERC20` entry) or root `deployed_addresses.json`.

### Operator Examples

#### 1. Mint Default 10,000 EURC to Recipient
```bash
npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Output:
```text
================================================================================
                         MockERC20 Token Mint Summary                           
================================================================================
Recipient Address : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Token Address     : 0x5FbDB2315678afecb367f032d93F642f64180aa3 (Euro Coin - EURC)
Decimals          : 6
--------------------------------------------------------------------------------
Minted Amount     : +10000 EURC (10000000000 base units)
Initial Balance   : 0.0 EURC
New Balance       : 10000.0 EURC
--------------------------------------------------------------------------------
Transaction Hash  : 0xb5f269a8b1c4e4776eec1020ddc98ff48f1082c3c9c99ec2426913e61a4ad19f
Block Number      : 12
================================================================================
```

#### 2. Mint Custom Amount (e.g. 50,000 EURC)
```bash
npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 50000
```

#### 3. Inspect Mock Token Balance
```bash
npm run mint-mock-token balance 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Output:
```text
================================================================================
                         MockERC20 Token Balance                                
================================================================================
Target Address    : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Token Address     : 0x5FbDB2315678afecb367f032d93F642f64180aa3 (Euro Coin - EURC)
Decimals          : 6
--------------------------------------------------------------------------------
Balance           : 10000.0 EURC (10000000000 base units)
================================================================================
```

#### 4. Mint Mock Tokens on Base Sepolia / Sepolia Testnet
```bash
npm run mint-mock-token -- 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 25000 --network baseSepolia
# or using npx tsx:
npx tsx scripts/mint-mock-token.ts 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 25000 --network baseSepolia
```

#### 5. Explicit Contract Address and Custom Amount
```bash
npm run mint-mock-token -- 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 10000 --token 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

#### 6. Hardhat Runner Execution
```bash
ACCOUNT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 AMOUNT=10000 npx hardhat run scripts/mint-mock-token.ts --network localhost
```

---

## 7. Collateral Vault Details Viewer (`scripts/view-vault.ts`)

The HoloFi protocol includes a dedicated CLI inspection tool located at [`scripts/view-vault.ts`](../scripts/view-vault.ts) to query and display comprehensive information about any given collateral vault (`vaultId`).

It aggregates data across:
- **`HoloFiVaultLoanCore`**: Vault status, owner address, principal debt, accumulated interest, pending interest, total debt, total FMV, max borrow capacity, and health factor.
- **`AccessControlManager`**: Store owner KYB verification status.
- **`HoloFiLendingPool`**: Pool name, symbol, underlying asset, risk parameters (Max LTV, Liquidation Threshold, Liquidation Penalty, APY), and eligibility policy.
- **`GradeEligibilityPolicy` / `ICardEligibilityPolicy`**: Policy criteria and rules (e.g. PSA 10 only).
- **`HoloFiVaultCard` & `HoloFiCardPriceFeed`**: Individual deposited card token IDs, token URIs, card type IDs, attestation hashes, and real-time Oracle FMV valuations.

### Command Syntax

#### Method A: Direct CLI Execution (Recommended)
```bash
npm run view-vault -- <vaultId> [loanCoreAddress] [options]
# or
npx tsx scripts/view-vault.ts <vaultId> [loanCoreAddress] [options]
```

#### Method B: Hardhat Run with Environment Variables
```bash
VAULT_ID=<vaultId> [LOAN_CORE_ADDRESS=<address>] npx hardhat run scripts/view-vault.ts --network <network>
```

### CLI Arguments & Options

| Argument / Flag | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `<vaultId>` | Positional / Required | Numeric ID of the collateral vault to inspect | `npm run view-vault 1` |
| `[loanCoreAddress]` | Positional / Optional | Address of the `HoloFiVaultLoanCore` contract | `npm run view-vault 1 0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `--loan-core`, `-l`, `--contract`, `-c` | Option Flag | Specify `HoloFiVaultLoanCore` contract address | `--loan-core 0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `--network`, `-n` | Option Flag | Target RPC network (default: `localhost`) | `--network baseSepolia` |
| `--help`, `-h` | Option Flag | Display usage instructions and examples | `npm run view-vault --help` |

### Address Resolution Precedence

The script resolves the `HoloFiVaultLoanCore` contract address with the following fallback hierarchy:

1. **CLI Positional Argument / Flag**: Passed directly via CLI or `--loan-core <address>`.
2. **Environment Variable**: `LOAN_CORE_ADDRESS`, `VAULT_LOAN_CORE_ADDRESS`, or `CONTRACT_ADDRESS`.
3. **Ignition Deployment Artefacts**: Auto-discovered from `ignition/deployments/chain-<chainId>/deployed_addresses.json` (`DeployHoloFiProtocol#HoloFiVaultLoanCore` or `HoloFiVaultLoanCore`) or root `deployed_addresses.json`.

### Operator Examples

#### 1. View Details for Active Collateral Vault
```bash
npm run view-vault 1
```

Output:
```text
================================================================================
                         HoloFi Collateral Vault Details                         
================================================================================
Vault ID           : #1
Vault Status       : ACTIVE [Borrowing & Collateral Active]
Vault Owner (Store): 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (KYB: APPROVED ✅)
Loan Core Contract : 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
Last Interest Sync : 2026-08-21T18:00:00.000Z
--------------------------------------------------------------------------------
Bound Lending Pool & Risk Configuration:
Lending Pool       : Premium Pool EURC (pEURC)
Pool Address       : 0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81
Underlying Asset   : Euro Coin (EURC) - 0x5FbDB2315678afecb367f032d93F642f64180aa3
Pool Risk Config   : Max LTV: 50.00% | Liq Threshold: 70.00% | Liq Penalty: 10.00% | APY: 5.00%
Eligibility Policy : GradeEligibilityPolicy (PSA Grade 10) [0x0165878A594ca255338adfa4d48449f69242Eb8F]
--------------------------------------------------------------------------------
Collateral & Valuation:
Deposited Cards    : 2 Card(s)
Total Collateral   : 5,000.00 EUR
Max Borrow Limit   : 2,500.00 EURC
Collateral Cards   :
  • Token #1 [0x8b329f6b92a543f9a7217983c27e8a946cb32cf39db99c855a8264e107db32d3] | FMV: 2,500.00 EUR | URI: ipfs://card1
  • Token #2 [0x3d49f60e909a39f6044a30a109787ff8c5120689b9101b0f5ef22dcf1e70e28f] | FMV: 2,500.00 EUR | URI: ipfs://card2
--------------------------------------------------------------------------------
Debt & Financial Health:
Principal Debt     : 1,000.00 EURC
Accumulated Interest: 5.20 EURC
Pending Interest   : 0.80 EURC
Total Debt         : 1,006.00 EURC
Remaining Borrow   : 1,494.00 EURC
Current LTV        : 20.12%
Health Factor (HF) : 3.48 (🟢 HEALTHY)
================================================================================
```

#### 2. Query Vault on Base Sepolia / Sepolia Testnet
```bash
npm run view-vault -- 1 --network baseSepolia
# or using npx tsx:
npx tsx scripts/view-vault.ts 1 --network baseSepolia
# or using environment variable:
HARDHAT_NETWORK=baseSepolia npm run view-vault 1
```

#### 3. Explicit Loan Core Contract Address
```bash
npm run view-vault 1 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

