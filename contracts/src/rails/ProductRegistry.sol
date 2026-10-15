// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Unauthorized } from "../utils/Errors.sol";

/// @title ProductRegistry
/// @notice Lists test investment products with a risk class from 1 (lowest) to 5 (highest), as a product
/// issuer or distributor would publish them. SuitabilityEnforcer compares this class with the class sealed
/// in the user's mandate. Test products only; no real fund is represented.
contract ProductRegistry {
    struct Product {
        bool listed;
        uint8 riskClass;
        bytes32 nameHash;
    }

    address public admin;
    mapping(address product => Product) public products;
    address[] private _all;

    event ProductListed(address indexed product, uint8 riskClass, bytes32 nameHash);
    event ProductDelisted(address indexed product);

    error InvalidRiskClass(uint8 riskClass);

    constructor(address _admin) {
        admin = _admin;
    }

    function list(address _product, uint8 _riskClass, bytes32 _nameHash) external {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        if (_riskClass == 0 || _riskClass > 5) revert InvalidRiskClass(_riskClass);
        if (!products[_product].listed) _all.push(_product);
        products[_product] = Product({ listed: true, riskClass: _riskClass, nameHash: _nameHash });
        emit ProductListed(_product, _riskClass, _nameHash);
    }

    function delist(address _product) external {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        products[_product].listed = false;
        emit ProductDelisted(_product);
    }

    function productInfo(address _product) external view returns (bool listed_, uint8 riskClass_) {
        Product storage p_ = products[_product];
        return (p_.listed, p_.riskClass);
    }

    function allProducts() external view returns (address[] memory) {
        return _all;
    }
}
