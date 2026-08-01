// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { AccessControlManager } from "./AccessControlManager.sol";
import { HoloFiCardCollection } from "./HoloFiCardCollection.sol";
import { HoloFiVaultLoanCore } from "./HoloFiVaultLoanCore.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract HoloFiVaultLoanCoreTest is Test, IERC721Receiver {
    AccessControlManager public acm;
    HoloFiCardCollection public cardCollection;
    HoloFiVaultLoanCore public loanCore;

    address public admin = address(0x1111);
    address public minter = address(0x2222);
    address public boutique = address(0x3333);
    address public unauthorized = address(0x4444);

    uint256 public cardId1;
    uint256 public cardId2;

    event VaultCreated(uint256 indexed vaultId, address indexed owner);
    event CollateralDeposited(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);
    event CollateralWithdrawn(uint256 indexed vaultId, address indexed owner, uint256[] tokenIds);

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function setUp() public {
        acm = new AccessControlManager(admin);
        cardCollection = new HoloFiCardCollection("HoloFi TCG Cards", "HFC", address(acm));
        loanCore = new HoloFiVaultLoanCore(address(acm), address(cardCollection));

        vm.startPrank(admin);
        acm.grantRole(acm.MINTER_ROLE(), minter);
        acm.grantRole(acm.ADMIN_ROLE(), address(loanCore));
        acm.setKybStatus(boutique, true);
        vm.stopPrank();

        bytes32 attestationHash1 = keccak256("raw_data_1");
        bytes32 attestationHash2 = keccak256("raw_data_2");
        vm.startPrank(minter);
        cardId1 = cardCollection.mintCard(boutique, attestationHash1, "ipfs://card1");
        cardId2 = cardCollection.mintCard(boutique, attestationHash2, "ipfs://card2");
        vm.stopPrank();
    }

    function test_Constructor_InitialState() public view {
        assertEq(address(loanCore.acm()), address(acm));
        assertEq(address(loanCore.nftCollection()), address(cardCollection));
        assertEq(loanCore.nextVaultId(), 1);
    }

    function test_RevertIf_Constructor_ZeroAddressACM() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressACM.selector));
        new HoloFiVaultLoanCore(address(0), address(cardCollection));
    }

    function test_RevertIf_Constructor_ZeroAddressNFT() public {
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.ZeroAddressNFT.selector));
        new HoloFiVaultLoanCore(address(acm), address(0));
    }

    function test_CreateVault_KybApprovedSuccess() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        assertEq(vaultId, 1);
        assertEq(loanCore.nextVaultId(), 2);

        HoloFiVaultLoanCore.CollateralVault memory vault = loanCore.getVault(vaultId);
        assertEq(vault.vaultId, 1);
        assertEq(vault.owner, boutique);
        assertEq(vault.principalDebt, 0);
        assertEq(vault.accumulatedInterest, 0);
        assertTrue(vault.status == HoloFiVaultLoanCore.VaultStatus.Active);
    }

    function test_RevertIf_CreateVault_NonKyb() public {
        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(HoloFiVaultLoanCore.KybRequired.selector, unauthorized));
        loanCore.createVault();
    }

    function test_DepositCollateral_Success() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        vm.prank(boutique);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(boutique);
        loanCore.depositCollateral(vaultId, tokenIds);

        assertEq(cardCollection.ownerOf(cardId1), address(loanCore));
        assertEq(cardCollection.ownerOf(cardId2), address(loanCore));

        HoloFiCardCollection.CardMetadata memory card1 = cardCollection.getCard(cardId1);
        HoloFiCardCollection.CardMetadata memory card2 = cardCollection.getCard(cardId2);
        assertTrue(card1.isLocked);
        assertTrue(card2.isLocked);

        assertEq(loanCore.nftVaultId(cardId1), vaultId);
        assertEq(loanCore.nftVaultId(cardId2), vaultId);

        uint256[] memory vaultTokens = loanCore.getVaultTokenIds(vaultId);
        assertEq(vaultTokens.length, 2);
        assertEq(vaultTokens[0], cardId1);
        assertEq(vaultTokens[1], cardId2);
    }

    function test_RevertIf_DepositCollateral_UnauthorizedOwner() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = cardId1;

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoloFiVaultLoanCore.UnauthorizedVaultOwner.selector,
                vaultId,
                unauthorized
            )
        );
        loanCore.depositCollateral(vaultId, tokenIds);
    }

    function test_WithdrawCollateral_Success() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        vm.prank(boutique);
        cardCollection.setApprovalForAll(address(loanCore), true);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = cardId1;
        tokenIds[1] = cardId2;

        vm.prank(boutique);
        loanCore.depositCollateral(vaultId, tokenIds);

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(boutique);
        loanCore.withdrawCollateral(vaultId, withdrawTokens);

        assertEq(cardCollection.ownerOf(cardId1), boutique);
        HoloFiCardCollection.CardMetadata memory card1 = cardCollection.getCard(cardId1);
        assertFalse(card1.isLocked);
        assertEq(loanCore.nftVaultId(cardId1), 0);

        uint256[] memory remainingTokens = loanCore.getVaultTokenIds(vaultId);
        assertEq(remainingTokens.length, 1);
        assertEq(remainingTokens[0], cardId2);
    }

    function test_RevertIf_WithdrawCollateral_NonVaultToken() public {
        vm.prank(boutique);
        uint256 vaultId = loanCore.createVault();

        uint256[] memory withdrawTokens = new uint256[](1);
        withdrawTokens[0] = cardId1;

        vm.prank(boutique);
        vm.expectRevert(
            abi.encodeWithSelector(HoloFiVaultLoanCore.TokenNotInVault.selector, cardId1, vaultId)
        );
        loanCore.withdrawCollateral(vaultId, withdrawTokens);
    }
}
