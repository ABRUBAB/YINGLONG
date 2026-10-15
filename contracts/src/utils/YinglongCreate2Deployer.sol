// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @title YinglongCreate2Deployer
/// @notice Minimal CREATE2 factory. Deployed from a fresh deployer key at nonce 0 on every ledger, it has the
/// same address everywhere; contracts deployed through it with the same salt and init code then also share
/// addresses (where the ledger implements CREATE2 address derivation like Ethereum).
contract YinglongCreate2Deployer {
    event Deployed(address indexed addr, bytes32 indexed salt, bytes32 initCodeHash);

    error DeployFailed();

    function deploy(bytes32 _salt, bytes calldata _initCode) external returns (address addr_) {
        bytes memory code_ = _initCode;
        assembly {
            addr_ := create2(0, add(code_, 0x20), mload(code_), _salt)
        }
        if (addr_ == address(0)) revert DeployFailed();
        emit Deployed(addr_, _salt, keccak256(_initCode));
    }

    function computeAddress(bytes32 _salt, bytes32 _initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt, _initCodeHash)))));
    }
}
