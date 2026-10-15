// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SpikeTestToken
/// @notice Test unit for the FISCO BCOS delegation spike. No value, no claim of any real asset.
///         The deployer mints the full supply to the recipient given in the constructor.
contract SpikeTestToken is ERC20 {
    constructor(address _holder, uint256 _supply) ERC20("YINGLONG Spike Test Unit", "tSPIKE") {
        _mint(_holder, _supply);
    }
}
