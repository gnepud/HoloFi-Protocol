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
7. [Optional] HoloFiLendingPool       ──► ERC-4626 liquidity pool instance
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
    "poolSymbol": "pEURC"
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
    "poolSymbol": "pEURC"
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
npm run roles check 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0xA4a75B3f3e957222E0d67Ea8b643F137BDFCe03B --network baseSepolia
```


