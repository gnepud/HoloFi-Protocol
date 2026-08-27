// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @title ICardEligibilityPolicy
/// @author Peng Du
/// @notice Interface for validating card collateral eligibility based on attributes.
interface ICardEligibilityPolicy {
    /// @notice Represents trading card grading attributes and metadata.
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

    /// @notice Emitted when a card type is evaluated and registered.
    /// @param cardTypeId Unique identifier of the registered card type.
    /// @param isEligible True if the card type meets eligibility rules.
    event CardTypeRegistered(bytes32 indexed cardTypeId, bool isEligible);

    /// @notice Emitted when an admin manual override is set for a card type.
    /// @param cardTypeId Unique identifier of the card type.
    /// @param isEligible The overridden eligibility status.
    event CardTypeOverrideUpdated(bytes32 indexed cardTypeId, bool isEligible);

    /// @notice Computes the deterministic card type identifier from attributes.
    /// @param attrs The structured card attributes.
    /// @return The keccak256 hash identifying the card type.
    function computeCardTypeId(CardAttributes calldata attrs) external pure returns (bytes32);

    /// @notice Evaluates and registers eligibility for a card type.
    /// @param attrs The structured card attributes to register.
    /// @return cardTypeId Computed identifier of the card type.
    /// @return isEligible True if the card type meets eligibility criteria.
    function registerCardType(CardAttributes calldata attrs) external returns (bytes32 cardTypeId, bool isEligible);

    /// @notice Checks if a card type identifier is eligible for borrowing.
    /// @param cardTypeId Unique identifier of the card type.
    /// @return True if the card type is eligible collateral.
    function isCardTypeEligible(bytes32 cardTypeId) external view returns (bool);
}
