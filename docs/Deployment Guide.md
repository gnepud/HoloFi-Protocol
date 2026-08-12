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
