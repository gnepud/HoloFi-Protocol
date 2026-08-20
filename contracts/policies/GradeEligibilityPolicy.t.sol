// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "../AccessControlManager.sol";
import { ICardEligibilityPolicy } from "../interfaces/ICardEligibilityPolicy.sol";
import { GradeEligibilityPolicy } from "./GradeEligibilityPolicy.sol";

contract GradeEligibilityPolicyTest is Test {
    AccessControlManager public acm;
    GradeEligibilityPolicy public psa10Policy;
    GradeEligibilityPolicy public psa9OrLowerPolicy;
    GradeEligibilityPolicy public anyGraderPolicy;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public unauthorized = address(0x3333);

    ICardEligibilityPolicy.CardAttributes public psa10Card;
    ICardEligibilityPolicy.CardAttributes public psa9Card;
    ICardEligibilityPolicy.CardAttributes public bgs10Card;

    event CardTypeRegistered(bytes32 indexed cardTypeId, bool isEligible);
    event CardTypeOverrideUpdated(bytes32 indexed cardTypeId, bool isEligible);

    function setUp() public {
        acm = new AccessControlManager(admin);

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);
        vm.stopPrank();

        // PSA 10 only (minGrade = 10, maxGrade = 0)
        psa10Policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 0);

        // PSA 9 or lower (minGrade = 0, maxGrade = 9)
        psa9OrLowerPolicy = new GradeEligibilityPolicy(address(acm), "PSA", 0, 9);

        // Any grader, grade 8 to 10
        anyGraderPolicy = new GradeEligibilityPolicy(address(acm), "", 8, 10);

        psa10Card = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base Set",
            cardName: "Charizard",
            cardNumber: "4/102",
            printing: "1st Edition",
            grader: "PSA",
            grade: "10"
        });

        psa9Card = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base Set",
            cardName: "Charizard",
            cardNumber: "4/102",
            printing: "1st Edition",
            grader: "PSA",
            grade: "9"
        });

        bgs10Card = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base Set",
            cardName: "Charizard",
            cardNumber: "4/102",
            printing: "1st Edition",
            grader: "BGS",
            grade: "10"
        });
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(psa10Policy.acm()), address(acm));
        assertEq(psa10Policy.requiredGrader(), "PSA");
        assertEq(psa10Policy.minGrade(), 10);
        assertEq(psa10Policy.maxGrade(), 0);

        assertEq(psa9OrLowerPolicy.requiredGrader(), "PSA");
        assertEq(psa9OrLowerPolicy.minGrade(), 0);
        assertEq(psa9OrLowerPolicy.maxGrade(), 9);

        assertEq(anyGraderPolicy.requiredGrader(), "");
        assertEq(anyGraderPolicy.minGrade(), 8);
        assertEq(anyGraderPolicy.maxGrade(), 10);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(GradeEligibilityPolicy.ZeroAddressACM.selector));
        new GradeEligibilityPolicy(address(0), "PSA", 10, 0);
    }

    function test_ParseGrade() public view {
        assertEq(psa10Policy.parseGrade("10"), 10);
        assertEq(psa10Policy.parseGrade("9"), 9);
        assertEq(psa10Policy.parseGrade("8"), 8);
        assertEq(psa10Policy.parseGrade("1"), 1);
        assertEq(psa10Policy.parseGrade("0"), 0);
        assertEq(psa10Policy.parseGrade(""), 0);
    }

    function test_ComputeCardTypeId() public view {
        bytes32 expected = keccak256(abi.encode(psa10Card));
        assertEq(psa10Policy.computeCardTypeId(psa10Card), expected);
    }

    function test_RegisterCardType_Eligible_PSA10() public {
        bytes32 cardTypeId = psa10Policy.computeCardTypeId(psa10Card);

        vm.expectEmit(true, true, true, true);
        emit CardTypeRegistered(cardTypeId, true);

        vm.prank(minter);
        (bytes32 registeredId, bool eligible) = psa10Policy.registerCardType(psa10Card);

        assertEq(registeredId, cardTypeId);
        assertTrue(eligible);
        assertTrue(psa10Policy.isCardTypeEligible(cardTypeId));
    }

    function test_RegisterCardType_Ineligible_GradeTooLow() public {
        bytes32 cardTypeId = psa10Policy.computeCardTypeId(psa9Card);

        vm.prank(minter);
        (bytes32 registeredId, bool eligible) = psa10Policy.registerCardType(psa9Card);

        assertEq(registeredId, cardTypeId);
        assertFalse(eligible);
        assertFalse(psa10Policy.isCardTypeEligible(cardTypeId));
    }

    function test_RegisterCardType_Eligible_MaxGradePolicy() public {
        bytes32 cardTypeId = psa9OrLowerPolicy.computeCardTypeId(psa9Card);

        vm.prank(minter);
        (bytes32 registeredId, bool eligible) = psa9OrLowerPolicy.registerCardType(psa9Card);

        assertEq(registeredId, cardTypeId);
        assertTrue(eligible);
        assertTrue(psa9OrLowerPolicy.isCardTypeEligible(cardTypeId));

        // PSA 10 on <= 9 policy should fail
        vm.prank(minter);
        (, bool eligible10) = psa9OrLowerPolicy.registerCardType(psa10Card);
        assertFalse(eligible10);
    }

    function test_RegisterCardType_Ineligible_GraderMismatch() public {
        bytes32 cardTypeId = psa10Policy.computeCardTypeId(bgs10Card);

        vm.prank(minter);
        (bytes32 registeredId, bool eligible) = psa10Policy.registerCardType(bgs10Card);

        assertEq(registeredId, cardTypeId);
        assertFalse(eligible);
        assertFalse(psa10Policy.isCardTypeEligible(cardTypeId));
    }

    function test_RegisterCardType_Eligible_AnyGrader() public {
        bytes32 cardTypeId = anyGraderPolicy.computeCardTypeId(bgs10Card);

        vm.prank(minter);
        (bytes32 registeredId, bool eligible) = anyGraderPolicy.registerCardType(bgs10Card);

        assertEq(registeredId, cardTypeId);
        assertTrue(eligible);
        assertTrue(anyGraderPolicy.isCardTypeEligible(cardTypeId));
    }

    function test_RegisterCardType_ExactGradePolicy() public {
        // Exact PSA 9 policy (minGrade = 9, maxGrade = 9)
        GradeEligibilityPolicy exact9Policy = new GradeEligibilityPolicy(address(acm), "PSA", 9, 9);

        // Exact PSA 10 policy (minGrade = 10, maxGrade = 10)
        GradeEligibilityPolicy exact10Policy = new GradeEligibilityPolicy(address(acm), "PSA", 10, 10);

        ICardEligibilityPolicy.CardAttributes memory psa8Card = ICardEligibilityPolicy.CardAttributes({
            game: "Pokemon",
            language: "EN",
            setName: "Base Set",
            cardName: "Charizard",
            cardNumber: "4/102",
            printing: "1st Edition",
            grader: "PSA",
            grade: "8"
        });

        // Exact 9 policy checks
        vm.startPrank(minter);
        (, bool exact9Matches9) = exact9Policy.registerCardType(psa9Card);
        assertTrue(exact9Matches9);

        (, bool exact9Matches8) = exact9Policy.registerCardType(psa8Card);
        assertFalse(exact9Matches8);

        (, bool exact9Matches10) = exact9Policy.registerCardType(psa10Card);
        assertFalse(exact9Matches10);

        // Exact 10 policy checks
        (, bool exact10Matches10) = exact10Policy.registerCardType(psa10Card);
        assertTrue(exact10Matches10);

        (, bool exact10Matches9) = exact10Policy.registerCardType(psa9Card);
        assertFalse(exact10Matches9);
        vm.stopPrank();
    }

    function test_SetCardTypeOverride_Success() public {
        bytes32 cardTypeId = psa10Policy.computeCardTypeId(psa9Card);
        assertFalse(psa10Policy.isCardTypeEligible(cardTypeId));

        vm.expectEmit(true, true, true, true);
        emit CardTypeOverrideUpdated(cardTypeId, true);

        vm.prank(minter);
        psa10Policy.setCardTypeOverride(cardTypeId, true);
        assertTrue(psa10Policy.isCardTypeEligible(cardTypeId));

        vm.expectEmit(true, true, true, true);
        emit CardTypeOverrideUpdated(cardTypeId, false);

        vm.prank(minter);
        psa10Policy.setCardTypeOverride(cardTypeId, false);
        assertFalse(psa10Policy.isCardTypeEligible(cardTypeId));
    }

    function test_RevertIf_RegisterCardType_Unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                GradeEligibilityPolicy.UnauthorizedMinter.selector,
                unauthorized
            )
        );
        psa10Policy.registerCardType(psa10Card);
    }

    function test_RevertIf_SetCardTypeOverride_Unauthorized() public {
        bytes32 cardTypeId = psa10Policy.computeCardTypeId(psa9Card);

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                GradeEligibilityPolicy.UnauthorizedMinter.selector,
                unauthorized
            )
        );
        psa10Policy.setCardTypeOverride(cardTypeId, true);
    }

    function test_RegisterCardType_Admin_Success() public {
        // admin does not have MINTER_ROLE, but has ADMIN_ROLE
        assertFalse(acm.hasRole(acm.MINTER_ROLE(), admin));
        assertTrue(acm.hasRole(acm.ADMIN_ROLE(), admin));

        bytes32 cardTypeId = psa10Policy.computeCardTypeId(psa10Card);

        vm.prank(admin);
        (bytes32 registeredId, bool eligible) = psa10Policy.registerCardType(psa10Card);

        assertEq(registeredId, cardTypeId);
        assertTrue(eligible);
        assertTrue(psa10Policy.isCardTypeEligible(cardTypeId));
    }

    function test_SetCardTypeOverride_Admin_Success() public {
        bytes32 cardTypeId = psa10Policy.computeCardTypeId(psa9Card);
        assertFalse(psa10Policy.isCardTypeEligible(cardTypeId));

        vm.prank(admin);
        psa10Policy.setCardTypeOverride(cardTypeId, true);
        assertTrue(psa10Policy.isCardTypeEligible(cardTypeId));
    }
}
