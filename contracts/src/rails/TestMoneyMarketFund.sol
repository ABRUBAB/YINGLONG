// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Unauthorized } from "../utils/Errors.sol";

/// @title TestMoneyMarketFund
/// @notice A test "money-market" product for the sweep scenario: subscribing = paying the fund's asset with
/// ERC-1363 `transferAndCall`; the fund mints shares 1:1 to the payer. Holders redeem shares 1:1. No yield,
/// no real fund, test units only. Listed in ProductRegistry with a risk class (a high-risk twin exists to
/// demonstrate the `UnsuitableProduct` revert).
contract TestMoneyMarketFund is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes4 internal constant ERC1363_RECEIVED = 0x88a7ca5c;

    address public asset;

    event Subscribed(address indexed investor, uint256 amount);
    event Redeemed(address indexed investor, uint256 shares);

    constructor(string memory _name, string memory _symbol, address _asset) ERC20(_name, _symbol) {
        asset = _asset;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice ERC-1363 receiver: subscription. First ABI word of `_data`, if present, must be this fund.
    function onTransferReceived(address, address _from, uint256 _value, bytes calldata _data)
        external
        nonReentrant
        returns (bytes4)
    {
        if (msg.sender != asset) revert Unauthorized(msg.sender);
        if (_data.length >= 32 && abi.decode(_data[:32], (address)) != address(this)) revert Unauthorized(msg.sender);
        _mint(_from, _value);
        emit Subscribed(_from, _value);
        return ERC1363_RECEIVED;
    }

    function redeem(uint256 _shares) external nonReentrant {
        _burn(msg.sender, _shares);
        IERC20(asset).safeTransfer(msg.sender, _shares);
        emit Redeemed(msg.sender, _shares);
    }
}
