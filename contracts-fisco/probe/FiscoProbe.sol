// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { P256SCLVerifierLib } from "@delegation-framework/libraries/P256SCLVerifierLib.sol";

/// @title ProbeChild
/// @notice Deployed by FiscoProbe through CREATE and CREATE2 to check address derivation.
contract ProbeChild {
    uint256 public immutable tag;

    constructor(uint256 _tag) {
        tag = _tag;
    }
}

/// @title ProbeP256
/// @notice Wraps the framework's P256 verifier (RIP-7212 precompile at 0x100 first, Solidity SCL
///         verifier as fallback) so its behaviour and gas can be measured on a given ledger.
contract ProbeP256 {
    function verify(bytes32 _hash, uint256 _r, uint256 _s, uint256 _x, uint256 _y) external view returns (bool) {
        return P256SCLVerifierLib.verifySignature(_hash, _r, _s, _x, _y);
    }
}

/// @title FiscoProbe
/// @notice Measures what a ledger's EVM actually does for the opcodes and precompiles YINGLONG
///         depends on. Every check is observable both through eth_call and inside a mined
///         transaction (via events), because some ledgers answer the two differently.
contract FiscoProbe {
    address internal constant P256_PRECOMPILE = address(0x100);
    address internal constant FISCO_CRYPTO_PRECOMPILE = address(0x100a);

    uint256 public counter;

    event Env(
        uint256 chainId,
        uint256 timestamp,
        uint256 number,
        uint256 gasLimit,
        uint256 baseFee,
        address coinbase,
        uint256 prevrandao,
        uint256 gasPrice,
        bytes32 previousBlockHash,
        uint256 gasLeft
    );
    event Ping(uint256 indexed n, address indexed sender, bytes32 data);
    event Deployed(address indexed child, address predicted, bool create2);

    /// @notice Block and transaction context as seen by the EVM.
    function env()
        public
        view
        returns (
            uint256 chainId,
            uint256 timestamp,
            uint256 number,
            uint256 gasLimit,
            uint256 baseFee,
            address coinbase,
            uint256 prevrandao,
            uint256 gasPrice,
            bytes32 previousBlockHash,
            uint256 gasLeft
        )
    {
        chainId = block.chainid;
        timestamp = block.timestamp;
        number = block.number;
        gasLimit = block.gaslimit;
        baseFee = block.basefee;
        coinbase = block.coinbase;
        prevrandao = block.prevrandao;
        gasPrice = tx.gasprice;
        previousBlockHash = number > 0 ? blockhash(number - 1) : bytes32(0);
        gasLeft = gasleft();
    }

    /// @notice Same as env(), but emitted from inside a mined transaction.
    function recordEnv() external {
        (
            uint256 chainId,
            uint256 timestamp,
            uint256 number,
            uint256 gasLimit,
            uint256 baseFee,
            address coinbase,
            uint256 prevrandao,
            uint256 gasPrice,
            bytes32 previousBlockHash,
            uint256 gasLeft
        ) = env();
        emit Env(chainId, timestamp, number, gasLimit, baseFee, coinbase, prevrandao, gasPrice, previousBlockHash, gasLeft);
    }

    /// @notice EXTCODEHASH / EXTCODESIZE of this contract, an EOA and an address with no account.
    function codeInfo(
        address _eoa,
        address _missing
    )
        external
        view
        returns (bytes32 self_, uint256 selfSize_, bytes32 eoa_, uint256 eoaSize_, bytes32 missing_)
    {
        self_ = address(this).codehash;
        selfSize_ = address(this).code.length;
        eoa_ = _eoa.codehash;
        eoaSize_ = _eoa.code.length;
        missing_ = _missing.codehash;
    }

    /// @notice Deploys a ProbeChild with CREATE2 and returns the actual and the locally predicted address.
    function deployCreate2(bytes32 _salt, uint256 _tag) external returns (address actual_, address predicted_) {
        bytes memory initCode_ = abi.encodePacked(type(ProbeChild).creationCode, abi.encode(_tag));
        predicted_ = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt, keccak256(initCode_)))))
        );
        actual_ = address(new ProbeChild{ salt: _salt }(_tag));
        emit Deployed(actual_, predicted_, true);
    }

    /// @notice Deploys a ProbeChild with CREATE (address from this contract's nonce).
    function deployCreate(uint256 _tag) external returns (address actual_) {
        actual_ = address(new ProbeChild(_tag));
        emit Deployed(actual_, address(0), false);
    }

    /// @notice Raw call to the RIP-7212 P256 precompile address.
    function rawP256(bytes calldata _input) external view returns (bool success_, uint256 returnLength_, bytes memory ret_) {
        (success_, ret_) = P256_PRECOMPILE.staticcall(_input);
        returnLength_ = ret_.length;
    }

    /// @notice Raw call to the FISCO crypto precompile (sm3, keccak256Hash, sm2Verify).
    function rawCrypto(bytes calldata _input) external view returns (bool success_, bytes memory ret_) {
        (success_, ret_) = FISCO_CRYPTO_PRECOMPILE.staticcall(_input);
    }

    /// @notice keccak256 computed by the EVM opcode, for comparison with SM3 on an SM build.
    function keccak(bytes calldata _data) external pure returns (bytes32) {
        return keccak256(_data);
    }

    /// @notice ecrecover precompile (0x01).
    function recover(bytes32 _hash, uint8 _v, bytes32 _r, bytes32 _s) external pure returns (address) {
        return ecrecover(_hash, _v, _r, _s);
    }

    /// @notice State change with an indexed event, used for eth_getLogs and gas estimation checks.
    function ping(bytes32 _data) external {
        counter += 1;
        emit Ping(counter, msg.sender, _data);
    }

    /// @notice Burns gas in a loop, used to compare eth_estimateGas with gasUsed.
    function burn(uint256 _iterations) external returns (uint256 acc_) {
        for (uint256 i_; i_ < _iterations; ++i_) {
            acc_ = uint256(keccak256(abi.encode(acc_, i_)));
        }
        counter = acc_;
    }

    /// @notice Always reverts with a reason string.
    function failWith(string calldata _reason) external pure {
        revert(_reason);
    }

    /// @notice Native value received (feature_balance check).
    function balanceOfThis() external view returns (uint256) {
        return address(this).balance;
    }
}
