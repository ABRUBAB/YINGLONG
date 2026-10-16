// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { stdError } from "forge-std/StdError.sol";
import { AccountabilityLedger } from "../../src/registries/AccountabilityLedger.sol";
import { Unauthorized } from "../../src/utils/Errors.sol";

/// @notice AccountabilityLedger: admin and anchorer roles, append-only hash-linked receipt batches, cross-ledger
/// anchors, receipt logs and Merkle inclusion proofs (sorted pairs, built in the test).
contract AccountabilityLedgerTest is Test {
    event AnchorerSet(address indexed anchorer, bool enabled);
    event AdminTransferred(address indexed from, address indexed to);
    event ReceiptBatchAnchored(uint256 indexed batchId, bytes32 indexed root, bytes32 prevRoot, uint64 count, string uri);
    event CrossAnchored(
        uint256 indexed crossId,
        uint256 indexed remoteChainId,
        uint256 remoteBlockNumber,
        bytes32 remoteBlockHash,
        bytes32 remoteRoot,
        uint256 remoteBatchId
    );
    event ReceiptLogged(bytes32 indexed receiptHash, address indexed agent, bytes32 indexed mandateHash, uint8 outcome);

    AccountabilityLedger internal ledger;
    address internal anchorer = makeAddr("anchorer");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        ledger = new AccountabilityLedger(address(this));
        ledger.setAnchorer(anchorer, true);
    }

    function _pair(bytes32 _a, bytes32 _b) internal pure returns (bytes32) {
        return _a < _b ? keccak256(abi.encodePacked(_a, _b)) : keccak256(abi.encodePacked(_b, _a));
    }

    function _anchor(bytes32 _root, uint64 _count) internal returns (uint256) {
        vm.prank(anchorer);
        return ledger.anchorBatch(_root, _count, "ipfs://batch");
    }

    // ------------------------------------------------------------------ roles

    function test_roles_onlyAdminManages() public {
        assertEq(ledger.admin(), address(this));
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, stranger));
        vm.prank(stranger);
        ledger.setAnchorer(stranger, true);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, stranger));
        vm.prank(stranger);
        ledger.transferAdmin(stranger);

        vm.expectEmit(true, true, true, true, address(ledger));
        emit AnchorerSet(stranger, true);
        ledger.setAnchorer(stranger, true);
        assertTrue(ledger.isAnchorer(stranger));

        address newAdmin_ = makeAddr("new-admin");
        vm.expectEmit(true, true, true, true, address(ledger));
        emit AdminTransferred(address(this), newAdmin_);
        ledger.transferAdmin(newAdmin_);
        assertEq(ledger.admin(), newAdmin_);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, address(this)));
        ledger.setAnchorer(stranger, false);
        vm.prank(newAdmin_);
        ledger.setAnchorer(stranger, false);
        assertFalse(ledger.isAnchorer(stranger));
    }

    function test_onlyAnchorersWrite() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, stranger));
        ledger.anchorBatch(keccak256("r"), 1, "");
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, stranger));
        ledger.crossAnchor(1, 1, bytes32(0), bytes32(0), 0);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, stranger));
        ledger.logReceipt(bytes32(0), stranger, bytes32(0), 1);
        vm.stopPrank();
        // A disabled anchorer loses the role.
        ledger.setAnchorer(anchorer, false);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, anchorer));
        _anchor(keccak256("r"), 1);
    }

    // ------------------------------------------------------------------ batches

    function test_anchorBatch_linksRootsAndEmits() public {
        (bytes32 r0_, uint256 id0_) = ledger.latestRoot();
        assertEq(r0_, bytes32(0));
        assertEq(id0_, 0);

        vm.roll(77);
        vm.expectEmit(true, true, true, true, address(ledger));
        emit ReceiptBatchAnchored(0, keccak256("root-0"), bytes32(0), 12, "ipfs://batch");
        assertEq(_anchor(keccak256("root-0"), 12), 0);
        vm.expectEmit(true, true, true, true, address(ledger));
        emit ReceiptBatchAnchored(1, keccak256("root-1"), keccak256("root-0"), 3, "ipfs://batch");
        assertEq(_anchor(keccak256("root-1"), 3), 1);

        AccountabilityLedger.Batch memory b_ = ledger.batchOf(1);
        assertEq(b_.root, keccak256("root-1"));
        assertEq(b_.prevRoot, keccak256("root-0"));
        assertEq(b_.count, 3);
        assertEq(b_.anchoredAt, block.timestamp);
        assertEq(b_.blockNumber, 77);
        assertEq(ledger.batchCount(), 2);
        assertEq(ledger.batchIdOfRoot(keccak256("root-0")), 1);
        assertEq(ledger.batchIdOfRoot(keccak256("root-1")), 2);
        (bytes32 r_, uint256 id_) = ledger.latestRoot();
        assertEq(r_, keccak256("root-1"));
        assertEq(id_, 1);
    }

    function test_anchorBatch_emptyOrDuplicate_reverts() public {
        vm.expectRevert(AccountabilityLedger.EmptyBatch.selector);
        _anchor(keccak256("root-0"), 0);
        _anchor(keccak256("root-0"), 1);
        vm.expectRevert(abi.encodeWithSelector(AccountabilityLedger.DuplicateRoot.selector, keccak256("root-0")));
        _anchor(keccak256("root-0"), 1);
        assertEq(ledger.batchCount(), 1);
    }

    function test_unknownBatch_reverts() public {
        vm.expectRevert(stdError.indexOOBError);
        ledger.batchOf(0);
        vm.expectRevert(stdError.indexOOBError);
        ledger.verifyReceipt(0, bytes32(0), new bytes32[](0));
        vm.expectRevert(stdError.indexOOBError);
        ledger.crossAnchorOf(0);
    }

    // ------------------------------------------------------------------ cross anchors and logs

    function test_crossAnchor_recordsRemoteState() public {
        vm.expectEmit(true, true, true, true, address(ledger));
        emit CrossAnchored(0, 84532, 1_000, keccak256("block"), keccak256("remote-root"), 5);
        vm.prank(anchorer);
        assertEq(ledger.crossAnchor(84532, 1_000, keccak256("block"), keccak256("remote-root"), 5), 0);
        AccountabilityLedger.CrossAnchor memory c_ = ledger.crossAnchorOf(0);
        assertEq(c_.remoteChainId, 84532);
        assertEq(c_.remoteBlockNumber, 1_000);
        assertEq(c_.remoteBlockHash, keccak256("block"));
        assertEq(c_.remoteRoot, keccak256("remote-root"));
        assertEq(c_.remoteBatchId, 5);
        assertEq(c_.recordedAt, block.timestamp);
        assertEq(ledger.crossAnchorCount(), 1);
    }

    function test_logReceipt_emits() public {
        vm.expectEmit(true, true, true, true, address(ledger));
        emit ReceiptLogged(keccak256("receipt"), stranger, keccak256("mandate"), 4);
        vm.prank(anchorer);
        ledger.logReceipt(keccak256("receipt"), stranger, keccak256("mandate"), 4);
    }

    // ------------------------------------------------------------------ inclusion proofs

    function test_verifyReceipt_sortedPairMerkleTree() public {
        bytes32[4] memory l_ = [keccak256("rcpt-a"), keccak256("rcpt-b"), keccak256("rcpt-c"), keccak256("rcpt-d")];
        bytes32 n01_ = _pair(l_[0], l_[1]);
        bytes32 n23_ = _pair(l_[2], l_[3]);
        bytes32 root_ = _pair(n01_, n23_);
        _anchor(keccak256("other-root"), 1);
        uint256 id_ = _anchor(root_, 4);

        for (uint256 i; i < 4; ++i) {
            bytes32[] memory proof_ = new bytes32[](2);
            proof_[0] = l_[i ^ 1];
            proof_[1] = i < 2 ? n23_ : n01_;
            assertTrue(ledger.verifyReceipt(id_, l_[i], proof_));
            assertFalse(ledger.verifyReceipt(0, l_[i], proof_)); // other batch
        }
        bytes32[] memory p_ = new bytes32[](2);
        p_[0] = l_[1];
        p_[1] = n23_;
        assertFalse(ledger.verifyReceipt(id_, keccak256("rcpt-x"), p_)); // not a leaf
        p_[1] = n01_;
        assertFalse(ledger.verifyReceipt(id_, l_[0], p_)); // wrong sibling
    }

    function testFuzz_rootsStayHashLinked(bytes32[5] memory _roots) public {
        bytes32 prev_;
        uint256 n_;
        for (uint256 i; i < 5; ++i) {
            if (ledger.batchIdOfRoot(_roots[i]) != 0) {
                vm.expectRevert(abi.encodeWithSelector(AccountabilityLedger.DuplicateRoot.selector, _roots[i]));
                _anchor(_roots[i], 1);
                continue;
            }
            uint256 id_ = _anchor(_roots[i], 1);
            assertEq(id_, n_++);
            assertEq(ledger.batchOf(id_).prevRoot, prev_);
            prev_ = _roots[i];
        }
        assertEq(ledger.batchCount(), n_);
    }
}
