# Mint Mock ERC20 Token CLI Script Specification (`scripts/mint-mock-token.ts`)

- **Feature**: Mint Mock ERC20 Tokens to Wallet Address
- **Status**: Draft / Approved Design
- **Date**: 2026-08-17
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

This specification defines the CLI script `scripts/mint-mock-token.ts` allowing developers and operators to mint `MockERC20` tokens (e.g., Mock EURC) to any specified wallet address and check on-chain token balances across local and testnet networks.

---

## 2. Technical Specification

### 2.1 Target Files & Dependencies
* **Script**: `scripts/mint-mock-token.ts`
* **Test Suite**: `test/MintMockTokenScript.ts`
* **Documentation**: `docs/Deployment Guide.md`
* **Configuration**: `package.json` (`"mint-mock-token": "tsx scripts/mint-mock-token.ts"`)

---

### 2.2 CLI Commands & Syntax

```bash
# 1. Mint mock tokens to a wallet address (Default amount: 10,000 tokens):
npm run mint-mock-token <recipient_address> [amount] [token_address] [--network <network>]

# Examples:
npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 50000
npm run mint-mock-token 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 10000 0x5FbDB2315678afecb367f032d93F642f64180aa3

# 2. Check mock token balance:
npm run mint-mock-token balance <target_address> [token_address] [--network <network>]
# or
npm run mint-mock-token check <target_address> [token_address] [--network <network>]

# Method B: Hardhat run with environment variables
RECIPIENT=<recipient_address> AMOUNT=10000 npx hardhat run scripts/mint-mock-token.ts --network <network>
```

---

### 2.3 Token Address Resolution Strategy

1. Positional CLI argument `[token_address]` or `--token <address>`.
2. Environment variables `MOCK_ERC20_ADDRESS` / `TOKEN_ADDRESS` / `MOCK_TOKEN_ADDRESS`.
3. Auto-discovery from Hardhat Ignition deployments (`ignition/deployments/chain-<chainId>/deployed_addresses.json` matching `"DeployHoloFiLendingPoolWithMock#MockERC20"` or `"MockERC20"`).

---

### 2.4 Features & Output Report

- **Decimal-Aware Scaling**: Automatically parses human input numbers (e.g. `10000`, `500.5`) using `ethers.parseUnits(amount, decimals)`.
- **Pre-flight & Post-flight Balance Display**: Shows recipient's balance before and after minting.
- **Transaction Receipt**: Logs transaction hash and block confirmation.
- **Bytecode Validation**: Verifies that the target contract is deployed and valid.

---

## 3. Testing & Verification Strategy

### 3.1 Integration Tests (`test/MintMockTokenScript.ts`)
- Test CLI argument parsing for `mint`, `balance`, `check` actions, recipient addresses, amount strings, custom addresses, and environment variables.
- Test `mintMockTokens`:
  - Mints tokens to recipient and verifies recipient balance increase by exact amount.
  - Formats human-readable output.
  - Tests default amount fallback (10,000).
- Test `checkTokenBalance`:
  - Queries name, symbol, decimals, and formatted balance.

---

## 4. Verification Criteria

- Clean compilation: `npx hardhat build && npx tsc --noEmit`
- Full test suite passing: `npx hardhat test` (All 239+ tests passing)
