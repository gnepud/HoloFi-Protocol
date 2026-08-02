# Vault State & Escrow Management (`HoloFiVaultLoanCore`) Specification

- **Feature**: HF-20 — Vault State & Escrow Management (`HoloFiVaultLoanCore`)
- **Status**: Draft / Approved Design
- **Date**: 2026-08-01
- **Author**: HoloFi Team

---

## 1. Overview & Objectives

`HoloFiVaultLoanCore` serves as the core credit and collateral management contract for the HoloFi protocol. It tracks isolated `CollateralVault` instances created by KYB-approved stores and manages the secure escrow of `HoloFiCardCollection` ERC-721 card NFTs as loan collateral.

---

## 2. Technical Specification

### 2.1 File Location & Dependencies
* **Loan Core File**: `contracts/HoloFiVaultLoanCore.sol`
* **Dependencies**:
  * `contracts/AccessControlManager.sol`
  * `contracts/HoloFiCardCollection.sol`
  * `@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol`

### 2.2 On-Chain Data Model & State Variables

```solidity
enum VaultStatus { Active, Liquidating, Closed }

struct CollateralVault {
    uint256 vaultId;
    address owner;               // Store wallet address
    uint256[] tokenIds;          // List of deposited NFT token IDs
    uint256 principalDebt;       // Borrowed capital
    uint256 accumulatedInterest; // Unpaid accrued interest
    uint256 lastInterestUpdateTime;  // Timestamp of last interest calculation
    VaultStatus status;
}

AccessControlManager public immutable acm;
HoloFiCardCollection public immutable nftCollection;

mapping(uint256 => CollateralVault) public vaults;
mapping(uint256 => uint256) public nftVaultId;
uint256 public nextVaultId = 1;

event VaultCreated(uint256 indexed vaultId, address indexed owner);
event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
```

### 2.3 Custom Errors
* `ZeroAddressACM()`: Constructor called with `address(0)` for `_acm`.
* `ZeroAddressNFT()`: Constructor called with `address(0)` for `_nftCollection`.
* `KybRequired(address caller)`: `createVault` called by non-KYB account.
* `UnauthorizedVaultOwner(uint256 vaultId, address caller)`: Caller is not the vault owner.
* `VaultNotActive(uint256 vaultId)`: Operation attempted on non-Active vault.
* `VaultHasActiveDebt(uint256 vaultId, uint256 totalDebt)`: Withdrawal attempted when principal + interest > 0.
* `EmptyTokenIdsList()`: Operation passed empty `tokenIds` array.
* `TokenAlreadyInVault(uint256 tokenId, uint256 existingVaultId)`: Token already deposited in a vault.
* `TokenNotInVault(uint256 tokenId, uint256 vaultId)`: Token not registered in specified vault.

### 2.4 Functions

#### `constructor(address _acm, address _nftCollection)`
- Reverts `ZeroAddressACM()` if `_acm == address(0)`.
- Reverts `ZeroAddressNFT()` if `_nftCollection == address(0)`.
- Stores `acm` and `nftCollection`.

#### `onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4)`
- Returns `IERC721Receiver.onERC721Received.selector`.

#### `createVault() external returns (uint256 vaultId)`
- **KYB Check**: Reverts `KybRequired(msg.sender)` if `!acm.isKybApproved(msg.sender)`.
- Logic:
  1. `vaultId = nextVaultId++`.
  2. Initializes `vaults[vaultId]` with `owner = msg.sender`, `status = VaultStatus.Active`, `lastInterestUpdateTime = block.timestamp`.
  3. Emits `VaultCreated(vaultId, msg.sender)`.
  4. Returns `vaultId`.

#### `depositCollateral(uint256 vaultId, uint256[] calldata tokenIds) external`
- Reverts `UnauthorizedVaultOwner(vaultId, msg.sender)` if `vaults[vaultId].owner != msg.sender`.
- Reverts `VaultNotActive(vaultId)` if `vaults[vaultId].status != VaultStatus.Active`.
- Reverts `EmptyTokenIdsList()` if `tokenIds.length == 0`.
- Logic per `tokenId`:
  1. Reverts `TokenAlreadyInVault(tokenId, nftVaultId[tokenId])` if `nftVaultId[tokenId] != 0`.
  2. Calls `nftCollection.safeTransferFrom(msg.sender, address(this), tokenId)`.
  3. Calls `nftCollection.setCardLock(tokenId, true)`.
  4. Pushes `tokenId` to `vaults[vaultId].tokenIds`.
  5. Sets `nftVaultId[tokenId] = vaultId`.
- Emits `CollateralDeposited(vaultId, msg.sender, tokenIds)`.

#### `withdrawCollateral(uint256 vaultId, uint256[] calldata tokenIds) external`
- Reverts `UnauthorizedVaultOwner(vaultId, msg.sender)` if `vaults[vaultId].owner != msg.sender`.
- Reverts `VaultNotActive(vaultId)` if `vaults[vaultId].status != VaultStatus.Active`.
- Reverts `EmptyTokenIdsList()` if `tokenIds.length == 0`.
- Calculates `uint256 totalDebt = vaults[vaultId].principalDebt + vaults[vaultId].accumulatedInterest`. Reverts `VaultHasActiveDebt(vaultId, totalDebt)` if `totalDebt > 0`.
- Logic per `tokenId`:
  1. Reverts `TokenNotInVault(tokenId, vaultId)` if `nftVaultId[tokenId] != vaultId`.
  2. Calls `nftCollection.setCardLock(tokenId, false)`.
  3. Calls `nftCollection.safeTransferFrom(address(this), msg.sender, tokenId)`.
  4. Removes `tokenId` from `vaults[vaultId].tokenIds` (swap-and-pop).
  5. Clears `nftVaultId[tokenId] = 0`.
- Emits `CollateralWithdrawn(vaultId, msg.sender, tokenIds)`.

#### `getVault(uint256 vaultId) external view returns (CollateralVault memory)`
- Returns `vaults[vaultId]`.

#### `getVaultTokenIds(uint256 vaultId) external view returns (uint256[] memory)`
- Returns `vaults[vaultId].tokenIds`.

---

## 3. Testing Strategy

### 3.1 Solidity Unit Tests (`contracts/HoloFiVaultLoanCore.t.sol`)
1. `test_Constructor_InitialState`: Verify `acm` and `nftCollection` addresses.
2. `test_CreateVault_KybApprovedSuccess`: KYB-approved store creates vault, verifying `vaultId = 1`, `owner`, and `status = Active`.
3. `test_RevertIf_CreateVault_NonKyb`: Non-KYB wallet reverts `KybRequired`.
4. `test_DepositCollateral_Success`: Deposit NFTs into vault, verifying transfer into `LoanCore`, `isLocked == true`, `nftVaultId`, and `tokenIds` list.
5. `test_RevertIf_DepositCollateral_Unauthorized`: Non-owner reverts `UnauthorizedVaultOwner`.
6. `test_WithdrawCollateral_Success`: Withdraw NFTs from zero-debt vault, verifying transfer back to store, `isLocked == false`, and cleared arrays.
7. `test_RevertIf_WithdrawCollateral_NonVaultToken`: Attempting to withdraw token not in vault reverts `TokenNotInVault`.

### 3.2 TypeScript Integration Tests (`test/HoloFiVaultLoanCore.ts`)
1. Deploy ACM, CardCollection, grant MINTER_ROLE, approve store for KYB.
2. Mint cards to store.
3. Store creates vault via `createVault()`.
4. Store approves `LoanCore` for cards, deposits cards via `depositCollateral()`, verifying card transfers and locks (`isLocked`).
5. Store withdraws cards via `withdrawCollateral()`, verifying card transfers back and unlocked status (`isLocked == false`).
6. Verify non-KYB wallet cannot create vault (`KybRequired`).

---

## 4. Verification Criteria

- Compile cleanly: `npx hardhat build`
- Typecheck cleanly: `npx tsc --noEmit`
- Run test suite: `npx hardhat test`
