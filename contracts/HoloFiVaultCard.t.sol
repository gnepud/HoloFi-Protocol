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
        uint256 tokenId = vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        assertEq(tokenId, 1);
        assertEq(vaultCard.ownerOf(1), user);
        assertEq(vaultCard.tokenURI(1), "ipfs://QmTestHash");

        HoloFiVaultCard.CardMetadata memory card = vaultCard.getCard(1);
        assertEq(card.tokenId, 1);
        assertEq(card.attestationHash, TEST_ATTESTATION);
        assertEq(card.isLocked, false);
        assertTrue(card.mintTimestamp > 0);
    }

    function test_VerifyAttestation_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        assertTrue(vaultCard.verifyAttestation(tokenId, RAW_DATA));
        assertFalse(vaultCard.verifyAttestation(tokenId, "WrongData"));
    }

    function test_SetCardLock_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(admin);
        vaultCard.setCardLock(tokenId, true);

        assertTrue(vaultCard.getCard(tokenId).isLocked);
    }

    function test_RevertIf_UnauthorizedLockOperator() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.UnauthorizedLockOperator.selector, user));
        vaultCard.setCardLock(tokenId, true);
    }

    function test_RevertIf_UnauthorizedMinter() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.UnauthorizedMinter.selector, user));
        vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_ZeroAddressRecipient() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiVaultCard.ZeroAddressRecipient.selector);
        vaultCard.mintCard(address(0), TEST_ATTESTATION, "ipfs://QmTestHash");
    }

    function test_RevertIf_InvalidAttestationHash() public {
        vm.prank(minter);
        vm.expectRevert(HoloFiVaultCard.InvalidAttestationHash.selector);
        vaultCard.mintCard(user, bytes32(0), "ipfs://QmTestHash");
    }

    function test_RevertIf_TokenDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.TokenDoesNotExist.selector, 999));
        vaultCard.getCard(999);

        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.TokenDoesNotExist.selector, 999));
        vaultCard.verifyAttestation(999, RAW_DATA);
    }

    function test_Transfer_UnlockedCard_Success() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        address recipient = address(0x4444);
        vm.prank(user);
        vaultCard.transferFrom(user, recipient, tokenId);

        assertEq(vaultCard.ownerOf(tokenId), recipient);
    }

    function test_RevertIf_TransferLockedCard() public {
        vm.prank(minter);
        uint256 tokenId = vaultCard.mintCard(user, TEST_ATTESTATION, "ipfs://QmTestHash");

        vm.prank(admin);
        vaultCard.setCardLock(tokenId, true);

        address recipient = address(0x4444);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultCard.CardIsLocked.selector, tokenId));
        vaultCard.transferFrom(user, recipient, tokenId);
    }
}
