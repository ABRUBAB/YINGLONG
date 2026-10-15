// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @title YinglongEIP712
/// @notice EIP-712 domain for YINGLONG contracts with an explicit salt and no immutables, so the runtime
/// bytecode is identical on every ledger (Base Sepolia, FISCO BCOS, exhibits). On FISCO BCOS the CHAINID
/// opcode may return 0, so the salt (keccak256("YINGLONG-<ledger name>")) is what separates the domains of
/// different ledgers (KR-16).
abstract contract YinglongEIP712 {
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)");

    /// @notice Domain salt, written once at construction (storage, not immutable).
    bytes32 public domainSalt;

    constructor(bytes32 _salt) {
        domainSalt = _salt;
    }

    function _domainName() internal pure virtual returns (string memory);

    function _domainVersion() internal pure virtual returns (string memory) {
        return "1";
    }

    /// @notice EIP-712 domain separator, recomputed on every call (no cached chain id).
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes(_domainName())),
                keccak256(bytes(_domainVersion())),
                block.chainid,
                address(this),
                domainSalt
            )
        );
    }

    function _hashTypedData(bytes32 _structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), _structHash));
    }
}
