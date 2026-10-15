// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @title PayeeBook
/// @notice Per-account book of verified payees, each with a budget category. Only the account itself can
/// write its own book (a T3 action: the user's passkey via a user operation). Delegations can never reach
/// this contract: the mandate compiler always lists it in ForbiddenTargetsEnforcer.
contract PayeeBook {
    struct Entry {
        uint32 categoryId;
        bool active;
        bytes32 labelHash; // keccak256 of the human label shown in the app, e.g. "Harbour Homes"
        uint64 addedAt;
    }

    mapping(address account => mapping(address payee => Entry)) private _entries;
    mapping(address account => address[]) private _payees;

    event PayeeSet(address indexed account, address indexed payee, uint32 categoryId, bytes32 labelHash);
    event PayeeRemoved(address indexed account, address indexed payee);

    error LengthMismatch();
    error ZeroPayee();

    /// @notice Add or update a payee in the caller's book.
    function setPayee(address _payee, uint32 _categoryId, bytes32 _labelHash) public {
        if (_payee == address(0)) revert ZeroPayee();
        Entry storage e_ = _entries[msg.sender][_payee];
        if (e_.addedAt == 0) {
            _payees[msg.sender].push(_payee);
            e_.addedAt = uint64(block.timestamp);
        }
        e_.categoryId = _categoryId;
        e_.active = true;
        e_.labelHash = _labelHash;
        emit PayeeSet(msg.sender, _payee, _categoryId, _labelHash);
    }

    function setPayees(address[] calldata _payeeList, uint32[] calldata _categories, bytes32[] calldata _labels) external {
        if (_payeeList.length != _categories.length || _payeeList.length != _labels.length) revert LengthMismatch();
        for (uint256 i; i < _payeeList.length; ++i) {
            setPayee(_payeeList[i], _categories[i], _labels[i]);
        }
    }

    function removePayee(address _payee) external {
        _entries[msg.sender][_payee].active = false;
        emit PayeeRemoved(msg.sender, _payee);
    }

    function entryOf(address _account, address _payee) external view returns (Entry memory) {
        return _entries[_account][_payee];
    }

    /// @return active_ whether `_payee` is an active verified payee of `_account`
    /// @return categoryId_ its budget category
    function lookup(address _account, address _payee) external view returns (bool active_, uint32 categoryId_) {
        Entry storage e_ = _entries[_account][_payee];
        return (e_.active, e_.categoryId);
    }

    function payeesOf(address _account) external view returns (address[] memory) {
        return _payees[_account];
    }
}
