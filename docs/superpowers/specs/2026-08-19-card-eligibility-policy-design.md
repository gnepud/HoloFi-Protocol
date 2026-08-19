# Card Eligibility Policy Engine & Collateral Validation Design Specification

- **Feature**: Pluggable Card Eligibility Policy & Integer Grade Range Validation
- **Status**: Draft / Approved Design
- **Date**: 2026-08-19
- **Author**: HoloFi Team
- **Linear Issue**: HF-38

---

## 1. Executive Summary & Problem Statement

In the HoloFi lending protocol, different `HoloFiLendingPool` instances offer distinct credit parameters (e.g. Premium Pool: 50% LTV, 5% APY vs. Deluxe Pool: 40% LTV, 8% APY).

To enforce collateral quality standards, pools must be able to define flexible integer grading criteria—including exact grades (e.g. PSA 10), minimum grade thresholds (e.g. $\ge 10$), maximum grade caps (e.g. $\le 9$), and grader filtering (e.g. PSA only).

### Key Features:
1. **Integer Grade Comparison (`minGrade` and `maxGrade`)**: Support integer comparison ($\ge 10$, $\le 9$, exact equality, or range $[8, 9]$).
2. **`MINTER_ROLE` Access Control**: Restrict `registerCardType` and `setCardTypeOverride` to accounts holding `MINTER_ROLE`.
3. **Hot-swappable Policy Engine**: `HoloFiLendingPool` holds an `eligibilityPolicy` pointer, defaulting to unrestricted/open when `address(0)`.
4. **On-Chain Collateral Enforcement**: `HoloFiVaultLoanCore.depositCollateral` validates each card's eligibility against the vault's bound lending pool.

---

## 2. Technical Architecture & Component Flow

```mermaid
flowchart TD
    Minter["Minter / Indexer (MINTER_ROLE)"] -->|1. mintCard(to, cardTypeId, attestationHash, uri)| VC["HoloFiVaultCard"]
    Minter -->|2. registerCardType(8 Attributes)| Policy["GradeEligibilityPolicy\n[implements ICardEligibilityPolicy]"]
    
    subgraph Evaluation ["Policy Evaluation"]
        Policy -->|Parse string grade to integer| Parse["e.g. '10' -> 10, '9' -> 9"]
        Parse -->|Check minGrade <= grade <= maxGrade| CheckGrade["matchesGrade && matchesGrader"]
        CheckGrade -->|Eligible| Whitelist["isEligible[cardTypeId] = true"]
    end
    
    Store["Store (Borrower)"] -->|3. depositCollateral(vaultId, tokenIds)| LC["HoloFiVaultLoanCore"]
    LC -->|4. getCard(tokenId).cardTypeId| VC
    LC -->|5. isCollateralAllowed(cardTypeId)| LP["HoloFiLendingPool"]
    
    LP -->|6a. If eligibilityPolicy == 0\n(Open Pool)| Allow["✅ Deposit Allowed"]
    LP -->|6b. If eligibilityPolicy != 0| CheckPolicy["Call Policy.isCardTypeEligible(cardTypeId)"]
    CheckPolicy -->|Eligible| Allow
    CheckPolicy -->|Ineligible| Reject["❌ Revert IneligibleCollateral(tokenId, cardTypeId, pool)"]
```

---

## 3. Data Model & Contract Interfaces

### 3.1 `contracts/interfaces/ICardEligibilityPolicy.sol`

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface ICardEligibilityPolicy {
    struct CardAttributes {
        string game;        // e.g. "Pokemon", "Magic: The Gathering"
        string language;    // e.g. "EN", "JP"
        string setName;     // e.g. "Base Set", "Evolving Skies"
        string cardName;    // e.g. "Charizard", "Pikachu Illustrator"
        string cardNumber;  // e.g. "4/102", "001"
        string printing;    // e.g. "1st Edition", "Shadowless", "Regular"
        string grader;      // e.g. "PSA", "BGS", "CGC"
        string grade;       // e.g. "10", "9", "8"
    }

    event CardTypeRegistered(bytes32 indexed cardTypeId, bool isEligible);
    event CardTypeOverrideUpdated(bytes32 indexed cardTypeId, bool isEligible);

    function computeCardTypeId(CardAttributes calldata attrs) external pure returns (bytes32);
    function registerCardType(CardAttributes calldata attrs) external returns (bytes32 cardTypeId, bool isEligible);
    function isCardTypeEligible(bytes32 cardTypeId) external view returns (bool);
}
```

---

### 3.2 `contracts/policies/GradeEligibilityPolicy.sol`

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "../AccessControlManager.sol";
import { ICardEligibilityPolicy } from "../interfaces/ICardEligibilityPolicy.sol";

/**
 * @title GradeEligibilityPolicy
 * @notice Validates card eligibility based on grader organization and integer grade ranges.
 */
contract GradeEligibilityPolicy is ICardEligibilityPolicy {
    AccessControlManager public immutable acm;
    string public requiredGrader; // e.g. "PSA", or empty for any grader
    uint256 public minGrade;      // e.g. 10 for >= 10, 0 for no minimum
    uint256 public maxGrade;      // e.g. 9 for <= 9, 0 for no maximum

    mapping(bytes32 => bool) public isEligible;

    error ZeroAddressACM();
    error UnauthorizedMinter(address caller);

    modifier onlyMinter() {
        if (!acm.hasRole(acm.MINTER_ROLE(), msg.sender)) {
            revert UnauthorizedMinter(msg.sender);
        }
        _;
    }

    constructor(
        address _acm,
        string memory _requiredGrader,
        uint256 _minGrade,
        uint256 _maxGrade
    ) {
        if (_acm == address(0)) revert ZeroAddressACM();
        acm = AccessControlManager(_acm);
        requiredGrader = _requiredGrader;
        minGrade = _minGrade;
        maxGrade = _maxGrade;
    }

    /**
     * @notice Parses integer grade string (e.g. "10", "9", "8") into uint256.
     */
    function parseGrade(string memory gradeStr) public pure returns (uint256) {
        bytes memory b = bytes(gradeStr);
        if (b.length == 0) return 0;

        uint256 res = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];
            if (char >= "0" && char <= "9") {
                res = res * 10 + (uint8(char) - uint8(bytes1("0")));
            }
        }
        return res;
    }

    function computeCardTypeId(CardAttributes calldata attrs) public pure override returns (bytes32) {
        return keccak256(
            abi.encode(
                attrs.game,
                attrs.language,
                attrs.setName,
                attrs.cardName,
                attrs.cardNumber,
                attrs.printing,
                attrs.grader,
                attrs.grade
            )
        );
    }

    function registerCardType(CardAttributes calldata attrs) external override onlyMinter returns (bytes32 cardTypeId, bool eligible) {
        cardTypeId = computeCardTypeId(attrs);
        uint256 numericGrade = parseGrade(attrs.grade);

        bool matchesGrader = bytes(requiredGrader).length == 0 ||
            keccak256(bytes(attrs.grader)) == keccak256(bytes(requiredGrader));

        bool matchesMin = minGrade == 0 || numericGrade >= minGrade;
        bool matchesMax = maxGrade == 0 || numericGrade <= maxGrade;

        eligible = matchesGrader && matchesMin && matchesMax;
        if (eligible) {
            isEligible[cardTypeId] = true;
            emit CardTypeRegistered(cardTypeId, true);
        }
    }

    function setCardTypeOverride(bytes32 cardTypeId, bool eligible) external onlyMinter {
        isEligible[cardTypeId] = eligible;
        emit CardTypeOverrideUpdated(cardTypeId, eligible);
    }

    function isCardTypeEligible(bytes32 cardTypeId) external view override returns (bool) {
        return isEligible[cardTypeId];
    }
}
```

---

### 3.3 `contracts/HoloFiLendingPool.sol` Integration

```solidity
address public eligibilityPolicy;

event EligibilityPolicyUpdated(address indexed newPolicy);

function setEligibilityPolicy(address _policy) external {
    if (!acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) revert UnauthorizedAdmin(msg.sender);
    eligibilityPolicy = _policy;
    emit EligibilityPolicyUpdated(_policy);
}

function isCollateralAllowed(bytes32 cardTypeId) public view returns (bool) {
    if (eligibilityPolicy == address(0)) {
        return true; // Unrestricted / permissive mode (e.g. Deluxe Pool)
    }
    return ICardEligibilityPolicy(eligibilityPolicy).isCardTypeEligible(cardTypeId);
}
```

---

### 3.4 `contracts/HoloFiVaultLoanCore.sol` Integration

```solidity
error IneligibleCollateral(uint256 tokenId, bytes32 cardTypeId, address lendingPool);

function depositCollateral(uint256 vaultId, uint256[] calldata tokenIds) external {
    CollateralVault storage vault = vaults[vaultId];
    if (vault.owner != msg.sender) revert UnauthorizedVaultOwner(vaultId, msg.sender);
    if (vault.status != VaultStatus.Active) revert VaultNotActive(vaultId);
    if (tokenIds.length == 0) revert EmptyTokenIdsList();

    HoloFiLendingPool pool = HoloFiLendingPool(vault.lendingPool);

    for (uint256 i = 0; i < tokenIds.length; i++) {
        uint256 tokenId = tokenIds[i];
        uint256 existingVault = nftVaultId[tokenId];
        if (existingVault != 0) {
            revert TokenAlreadyInVault(tokenId, existingVault);
        }

        HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(tokenId);
        if (!pool.isCollateralAllowed(card.cardTypeId)) {
            revert IneligibleCollateral(tokenId, card.cardTypeId, vault.lendingPool);
        }

        vaultCard.safeTransferFrom(msg.sender, address(this), tokenId);
        vaultCard.setCardLock(tokenId, true);

        vault.tokenIds.push(tokenId);
        nftVaultId[tokenId] = vaultId;
    }

    emit CollateralDeposited(vaultId, msg.sender, tokenIds);
}
```

---

## 4. Hardhat Ignition Deployment Modules

- In `ignition/modules/DeployHoloFiLendingPoolWithMock.ts`:
  - Deploy `GradeEligibilityPolicy(acm, "PSA", 10, 0)` ($\ge 10$ PSA only) as `premiumPoolPolicy`.
  - Wire `premiumLendingPool.setEligibilityPolicy(premiumPoolPolicy)`.
  - Leave `deluxeLendingPool` without policy (`address(0)`), allowing all card grades.

---

## 5. Verification Plan

1. **Unit Testing (`contracts/policies/GradeEligibilityPolicy.t.sol`)**:
   - `parseGrade` parses `"10"`, `"9"`, `"8"` into `10`, `9`, `8`.
   - `registerCardType` with PSA 10 on $\ge 10$ policy registers `isEligible = true`.
   - `registerCardType` with PSA 9 on $\ge 10$ policy returns `(cardTypeId, false)` and leaves `isEligible = false`.
   - `registerCardType` with PSA 9 on $\le 9$ policy registers `isEligible = true`.
   - Non-minter calling `registerCardType` or `setCardTypeOverride` reverts with `UnauthorizedMinter`.
   - Minter calling `setCardTypeOverride` updates whitelist.
2. **Integration Testing (`test/HoloFiVaultLoanCore.ts`)**:
   - Vault with Premium Pool accepts PSA 10 card deposit.
   - Vault with Premium Pool reverts with `IneligibleCollateral` when attempting to deposit PSA 9 card.
   - Vault with Deluxe Pool accepts both PSA 10 and PSA 9 cards without restriction.
3. **Full Protocol Verification**:
   - `npx hardhat build && npx tsc --noEmit && npx hardhat test` (All tests passing).
