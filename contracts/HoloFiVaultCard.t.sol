// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiVaultCard } from "./HoloFiVaultCard.sol";

contract HoloFiVaultCardTest is Test {
    AccessControlManager public acm;
    HoloFiVaultCard public vaultCard;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public user = address(0x3333);

    bytes32 public constant TEST_CARD_TYPE_ID = keccak256("Pikachu_Illustrator_PSA10");
    bytes32 public constant TEST_ATTESTATION = keccak256("Blink:PSA:10:123456");
    bytes public constant RAW_DATA = "Blink:PSA:10:123456";

    function setUp() public {
        acm = new AccessControlManager(admin);
        bytes32 minterRole = acm.MINTER_ROLE();
        vm.prank(admin);
        acm.grantRole(minterRole, minter);

        vaultCard = new HoloFiVaultCard("HoloFi TCG Cards", "HFC", address(acm));
    }

    function test_Constructor_InitialState() public view {
        assertEq(vaultCard.name(), "HoloFi TCG Cards");
        assertEq(vaultCard.symbol(), "HFC");
        assertEq(address(vaultCard.acm()), address(acm));
        assertEq(vaultCard.nextTokenId(), 1);
    }

    function test_RevertIf_ZeroAddressACM() public {
        vm.expectRevert(HoloFiVaultCard.ZeroAddressACM.selector);
        new HoloFiVaultCard("HoloFi", "HFC", address(0));
    }

    function test_MintCard_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        assertEq(tokenId, 1);
        assertEq(vaultCard.ownerOf(1), user);
        assertEq(vaultCard.tokenURI(1), "ipfs://QmTestHash");

        HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(1);
        assertEq(card.tokenId, 1);
        assertEq(card.cardTypeId, TEST_CARD_TYPE_ID);
        assertEq(card.attestationHash, TEST_ATTESTATION);
        assertEq(card.isLocked, false);
        assertTrue(card.mintTimestamp > 0);
    }

    function test_VerifyAttestation_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        assertTrue(vaultCard.verifyAttestation(tokenId, RAW_DATA));
        assertFalse(vaultCard.verifyAttestation(tokenId, "WrongData"));
    }

    function test_SetCardLock_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(admin);
        vaultCard.setCardLock(tokenId, true);

        assertTrue(vaultCard.getCard(tokenId).isLocked);
    }

    function test_SetCardLock_ByLockerRole_Success() public {
        address locker = address(0x9999);
        bytes32 lockerRole = acm.LOCKER_ROLE();
        vm.prank(admin);
        acm.grantRole(lockerRole, locker);

        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(locker);
        vaultCard.setCardLock(tokenId, true);
        assertTrue(vaultCard.getCard(tokenId).isLocked);

        vm.prank(locker);
        vaultCard.setCardLock(tokenId, false);
        assertFalse(vaultCard.getCard(tokenId).isLocked);
    }

    function test_RevertIf_UnauthorizedLockOperator() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.UnauthorizedLockOperator.selector, user));
        vaultCard.setCardLock(tokenId, true);
    }

    function test_RevertIf_UnauthorizedMinter() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.UnauthorizedMinter.selector, user));
        vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_ZeroAddressRecipient() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiVaultCard.ZeroAddressRecipient.selector);
        vaultCard.mintCard(address(0), TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_MintCard_ZeroCardTypeId() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiVaultCard.ZeroCardTypeId.selector);
        vaultCard.mintCard(user, bytes32(0), TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_InvalidAttestationHash() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiVaultCard.InvalidAttestationHash.selector);
        vaultCard.mintCard(user, TEST_CARD_TYPE_ID, bytes32(0), "ipfs://QmTestHash");
    }

    function test_RevertIf_TokenDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.TokenDoesNotExist.selector, 999));
        vaultCard.getCard(999);

        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.TokenDoesNotExist.selector, 999));
        vaultCard.verifyAttestation(999, RAW_DATA);
    }

    function test_Transfer_UnlockedCard_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        address recipient = address(0x4444);
        vm.prank(user);
        vaultCard.transferFrom(user, recipient, tokenId);

        assertEq(vaultCard.ownerOf(tokenId), recipient);
    }

    function test_RevertIf_TransferLockedCard() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(admin);
        vaultCard.setCardLock(tokenId, true);

        address recipient = address(0x4444);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.CardIsLocked.selector, tokenId));
        vaultCard.transferFrom(user, recipient, tokenId);
    }

    function test_BurnCard_OwnerSuccess() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit HoloFiVaultCard.CardBurned(tokenId, user, TEST_CARD_TYPE_ID, TEST_ATTESTATION);
        vaultCard.burnCard(tokenId);

        assertEq(vaultCard.balanceOf(user), 0);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.TokenDoesNotExist.selector, tokenId));
        vaultCard.getCard(tokenId);
    }

    function test_BurnCard_ApprovedOperatorSuccess() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        address operator = address(0x5555);
        vm.prank(user);
        vaultCard.approve(operator, tokenId);

        vm.prank(operator);
        vm.expectEmit(true, true, true, true);
        emit HoloFiVaultCard.CardBurned(tokenId, user, TEST_CARD_TYPE_ID, TEST_ATTESTATION);
        vaultCard.burnCard(tokenId);

        assertEq(vaultCard.balanceOf(user), 0);
    }

    function test_RevertIf_BurnCard_UnauthorizedCaller() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        address unauthorized = address(0x6666);
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.UnauthorizedBurner.selector, unauthorized));
        vaultCard.burnCard(tokenId);
    }

    function test_RevertIf_BurnCard_LockedCard() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_CARD_TYPE_ID, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(admin);
        vaultCard.setCardLock(tokenId, true);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.CardIsLocked.selector, tokenId));
        vaultCard.burnCard(tokenId);
    }

    function test_RevertIf_BurnCard_NonExistentToken() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.TokenDoesNotExist.selector, 999));
        vaultCard.burnCard(999);
    }
}
