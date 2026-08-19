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
