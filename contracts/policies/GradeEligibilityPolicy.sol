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
        if (!acm.hasRole(acm.MINTER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
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
        return keccak256(abi.encode(attrs));
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
