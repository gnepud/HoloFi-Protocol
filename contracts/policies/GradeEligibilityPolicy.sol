// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { AccessControlManager } from "../AccessControlManager.sol";
import { ICardEligibilityPolicy } from "../interfaces/ICardEligibilityPolicy.sol";

/// @title GradeEligibilityPolicy
/// @author Peng Du
/// @notice Validates card collateral eligibility based on grading company and score ranges.
/// @dev Implements ICardEligibilityPolicy using integer comparison on parsed grades.
contract GradeEligibilityPolicy is ICardEligibilityPolicy {
    /// @notice The access control manager contract instance.
    AccessControlManager public immutable acm;

    /// @notice Required grading company name (e.g. PSA). If empty, all companies are accepted.
    string public requiredGrader;

    /// @notice Minimum acceptable numerical grade. Set to 0 for no minimum limit.
    uint256 public minGrade;

    /// @notice Maximum acceptable numerical grade. Set to 0 for no maximum limit.
    uint256 public maxGrade;

    /// @notice Maps a card type identifier to its eligibility status.
    mapping(bytes32 => bool) public isEligible;

    /// @notice Reverts when the access control manager address is zero.
    error ZeroAddressACM();

    /// @notice Reverts when caller lacks the minter or admin role.
    /// @param caller Address of the unauthorized caller.
    error UnauthorizedMinter(address caller);

    modifier onlyMinter() {
        if (!acm.hasRole(acm.MINTER_ROLE(), msg.sender) && !acm.hasRole(acm.ADMIN_ROLE(), msg.sender)) {
            revert UnauthorizedMinter(msg.sender);
        }
        _;
    }

    /// @notice Initializes the policy with grader filter and acceptable grade boundaries.
    /// @param _acm Address of the AccessControlManager contract.
    /// @param _requiredGrader Name of the required grading organization (e.g. PSA). Empty allows any grader.
    /// @param _minGrade Minimum acceptable numerical grade (0 for no minimum).
    /// @param _maxGrade Maximum acceptable numerical grade (0 for no maximum).
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

    /// @notice Parses an integer grade string into a numerical value.
    /// @param gradeStr Grade string to convert (e.g. "10", "9").
    /// @return Numerical value of the grade string.
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

    /// @notice Computes a unique card type identifier from card attributes.
    /// @param attrs The structured card attributes.
    /// @return The keccak256 hash of the encoded attributes.
    function computeCardTypeId(CardAttributes calldata attrs) public pure override returns (bytes32) {
        return keccak256(abi.encode(attrs));
    }

    /// @notice Evaluates and registers eligibility for a card type based on policy rules.
    /// @dev Checks matching grader organization and grade boundaries.
    /// @param attrs The structured card attributes.
    /// @return cardTypeId Computed identifier of the card type.
    /// @return eligible True if the card satisfies policy rules.
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

    /// @notice Manually overrides the eligibility status for a card type.
    /// @param cardTypeId Identifier of the card type to override.
    /// @param eligible New eligibility status to assign.
    function setCardTypeOverride(bytes32 cardTypeId, bool eligible) external onlyMinter {
        isEligible[cardTypeId] = eligible;
        emit CardTypeOverrideUpdated(cardTypeId, eligible);
    }

    /// @notice Checks if a card type is marked as eligible.
    /// @param cardTypeId Identifier of the card type.
    /// @return True if the card type is eligible.
    function isCardTypeEligible(bytes32 cardTypeId) external view override returns (bool) {
        return isEligible[cardTypeId];
    }
}
