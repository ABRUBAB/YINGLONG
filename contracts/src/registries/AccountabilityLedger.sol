// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Unauthorized } from "../utils/Errors.sol";

/// @title AccountabilityLedger
/// @notice The Vein pillar's anchor. Accountability receipts (EIP-712 structs produced off-chain for every
/// action, allowed or refused) are hashed into Merkle batches; each batch root is anchored here on both
/// ledgers, and each ledger records the other's latest root and block hash (two-way anchoring), so a
/// regulator can verify any receipt against either chain.
///
/// The anchor role can only append roots; it can never alter or delete one.
contract AccountabilityLedger {
    struct Batch {
        bytes32 root;
        bytes32 prevRoot;
        uint64 count;
        uint64 anchoredAt;
        uint64 blockNumber;
    }

    struct CrossAnchor {
        uint256 remoteChainId;
        uint256 remoteBlockNumber;
        bytes32 remoteBlockHash;
        bytes32 remoteRoot;
        uint256 remoteBatchId;
        uint64 recordedAt;
    }

    address public admin;
    mapping(address => bool) public isAnchorer;

    Batch[] private _batches;
    CrossAnchor[] private _crossAnchors;
    mapping(bytes32 root => uint256 batchIdPlusOne) public batchIdOfRoot;

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

    error DuplicateRoot(bytes32 root);
    error EmptyBatch();

    constructor(address _admin) {
        admin = _admin;
    }

    modifier onlyAnchorer() {
        if (!isAnchorer[msg.sender]) revert Unauthorized(msg.sender);
        _;
    }

    function setAnchorer(address _anchorer, bool _enabled) external {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        isAnchorer[_anchorer] = _enabled;
        emit AnchorerSet(_anchorer, _enabled);
    }

    function transferAdmin(address _to) external {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        emit AdminTransferred(admin, _to);
        admin = _to;
    }

    /// @notice Anchor a batch of receipt hashes (sorted-pair Merkle tree, OpenZeppelin MerkleProof convention).
    function anchorBatch(bytes32 _root, uint64 _count, string calldata _uri) external onlyAnchorer returns (uint256 batchId_) {
        if (_count == 0) revert EmptyBatch();
        if (batchIdOfRoot[_root] != 0) revert DuplicateRoot(_root);
        bytes32 prev_ = _batches.length == 0 ? bytes32(0) : _batches[_batches.length - 1].root;
        batchId_ = _batches.length;
        _batches.push(
            Batch({ root: _root, prevRoot: prev_, count: _count, anchoredAt: uint64(block.timestamp), blockNumber: uint64(block.number) })
        );
        batchIdOfRoot[_root] = batchId_ + 1;
        emit ReceiptBatchAnchored(batchId_, _root, prev_, _count, _uri);
    }

    /// @notice Record the other ledger's latest anchored root and the block that holds it.
    function crossAnchor(
        uint256 _remoteChainId,
        uint256 _remoteBlockNumber,
        bytes32 _remoteBlockHash,
        bytes32 _remoteRoot,
        uint256 _remoteBatchId
    )
        external
        onlyAnchorer
        returns (uint256 crossId_)
    {
        crossId_ = _crossAnchors.length;
        _crossAnchors.push(
            CrossAnchor({
                remoteChainId: _remoteChainId,
                remoteBlockNumber: _remoteBlockNumber,
                remoteBlockHash: _remoteBlockHash,
                remoteRoot: _remoteRoot,
                remoteBatchId: _remoteBatchId,
                recordedAt: uint64(block.timestamp)
            })
        );
        emit CrossAnchored(crossId_, _remoteChainId, _remoteBlockNumber, _remoteBlockHash, _remoteRoot, _remoteBatchId);
    }

    /// @notice Optional per-receipt log for the most important receipts (allowed payments, refusals, pauses).
    function logReceipt(bytes32 _receiptHash, address _agent, bytes32 _mandateHash, uint8 _outcome) external onlyAnchorer {
        emit ReceiptLogged(_receiptHash, _agent, _mandateHash, _outcome);
    }

    // ------------------------------------------------------------------ views

    function batchCount() external view returns (uint256) {
        return _batches.length;
    }

    function batchOf(uint256 _batchId) external view returns (Batch memory) {
        return _batches[_batchId];
    }

    function crossAnchorCount() external view returns (uint256) {
        return _crossAnchors.length;
    }

    function crossAnchorOf(uint256 _crossId) external view returns (CrossAnchor memory) {
        return _crossAnchors[_crossId];
    }

    function latestRoot() external view returns (bytes32 root_, uint256 batchId_) {
        if (_batches.length == 0) return (bytes32(0), 0);
        batchId_ = _batches.length - 1;
        root_ = _batches[batchId_].root;
    }

    /// @notice Verify that `_leaf` (a receipt hash) is included in batch `_batchId`.
    function verifyReceipt(uint256 _batchId, bytes32 _leaf, bytes32[] calldata _proof) external view returns (bool) {
        return MerkleProof.verifyCalldata(_proof, _batches[_batchId].root, _leaf);
    }
}
