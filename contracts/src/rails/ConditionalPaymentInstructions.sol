// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Unauthorized } from "../utils/Errors.sol";

/// @title ConditionalPaymentInstructions
/// @notice The coin-free mainland rail. Nothing on this ledger has monetary value: an account issues a
/// pre-authorised, conditional payment INSTRUCTION; an e-CNY-style simulator, playing the operator bank,
/// executes or rejects it off-chain and records the result here. The simulator also posts the simulated
/// deposit balance, so `balanceOf` (posted balance minus pending instructions) lets the same reserve-floor
/// rule run on this rail. Label in every interface: "e-CNY-style simulator. Not the PBoC sandbox; no
/// connection to PBoC or operator-bank systems."
/// Rail kind 3 (coin-free), which JurisdictionEnforcer requires under the mainland profile.
contract ConditionalPaymentInstructions {
    enum Status {
        None,
        Pending,
        Executed,
        Rejected,
        Expired
    }

    struct Instruction {
        address account;
        address payee;
        uint256 amount; // base units of CNY (fen), 2 decimals
        bytes32 purposeHash;
        bytes32 conditionHash;
        uint64 validUntil;
        uint64 createdAt;
        Status status;
        bytes32 resultRef; // simulator reference (hash) or reason code
    }

    uint8 public constant railKind = 3;
    uint8 public constant decimals = 2;
    string public constant name = "Coin-free conditional payment instructions (e-CNY-style simulator)";

    address public operator;
    Instruction[] private _instructions;
    mapping(address account => uint256) public postedBalance;
    mapping(address account => uint256) public pendingTotal;

    event Instructed(
        uint256 indexed id,
        address indexed account,
        address indexed payee,
        uint256 amount,
        bytes32 purposeHash,
        bytes32 conditionHash,
        uint64 validUntil
    );
    event Executed(uint256 indexed id, bytes32 simulatorRef);
    event Rejected(uint256 indexed id, bytes32 reasonCode);
    event Expired(uint256 indexed id);
    event BalancePosted(address indexed account, uint256 balance, bytes32 statementRef);
    event OperatorTransferred(address indexed from, address indexed to);

    error InvalidStatus(uint256 id);
    error NotExpired(uint256 id);
    error InsufficientAvailable(uint256 available, uint256 amount);

    constructor(address _operator) {
        operator = _operator;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized(msg.sender);
        _;
    }

    /// @notice Issue a conditional payment instruction from the calling account.
    function instruct(address _payee, uint256 _amount, bytes32 _purposeHash, bytes32 _conditionHash, uint64 _validUntil)
        external
        returns (uint256 id_)
    {
        uint256 available_ = balanceOf(msg.sender);
        if (_amount > available_) revert InsufficientAvailable(available_, _amount);
        id_ = _instructions.length;
        _instructions.push(
            Instruction({
                account: msg.sender,
                payee: _payee,
                amount: _amount,
                purposeHash: _purposeHash,
                conditionHash: _conditionHash,
                validUntil: _validUntil,
                createdAt: uint64(block.timestamp),
                status: Status.Pending,
                resultRef: bytes32(0)
            })
        );
        pendingTotal[msg.sender] += _amount;
        emit Instructed(id_, msg.sender, _payee, _amount, _purposeHash, _conditionHash, _validUntil);
    }

    function execute(uint256 _id, bytes32 _simulatorRef) external onlyOperator {
        Instruction storage i_ = _pending(_id);
        i_.status = Status.Executed;
        i_.resultRef = _simulatorRef;
        pendingTotal[i_.account] -= i_.amount;
        postedBalance[i_.account] -= i_.amount;
        postedBalance[i_.payee] += i_.amount;
        emit Executed(_id, _simulatorRef);
    }

    function reject(uint256 _id, bytes32 _reasonCode) external onlyOperator {
        Instruction storage i_ = _pending(_id);
        i_.status = Status.Rejected;
        i_.resultRef = _reasonCode;
        pendingTotal[i_.account] -= i_.amount;
        emit Rejected(_id, _reasonCode);
    }

    function expire(uint256 _id) external {
        Instruction storage i_ = _pending(_id);
        if (block.timestamp <= i_.validUntil) revert NotExpired(_id);
        i_.status = Status.Expired;
        pendingTotal[i_.account] -= i_.amount;
        emit Expired(_id);
    }

    function postBalance(address _account, uint256 _balance, bytes32 _statementRef) external onlyOperator {
        postedBalance[_account] = _balance;
        emit BalancePosted(_account, _balance, _statementRef);
    }

    function transferOperator(address _to) external onlyOperator {
        emit OperatorTransferred(operator, _to);
        operator = _to;
    }

    /// @notice Available simulated balance: posted balance minus pending instructions.
    function balanceOf(address _account) public view returns (uint256) {
        uint256 posted_ = postedBalance[_account];
        uint256 pending_ = pendingTotal[_account];
        return posted_ > pending_ ? posted_ - pending_ : 0;
    }

    function instructionOf(uint256 _id) external view returns (Instruction memory) {
        return _instructions[_id];
    }

    function instructionCount() external view returns (uint256) {
        return _instructions.length;
    }

    function _pending(uint256 _id) private view returns (Instruction storage i_) {
        i_ = _instructions[_id];
        if (i_.status != Status.Pending) revert InvalidStatus(_id);
    }
}
