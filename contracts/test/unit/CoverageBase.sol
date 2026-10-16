// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeLib, ModeSelector, ModePayload } from "@erc7579/lib/ModeLib.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { EncoderLib } from "@delegation-framework/libraries/EncoderLib.sol";
import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { Delegation, Caveat, ModeCode } from "@delegation-framework/utils/Types.sol";
import { CALLTYPE_SINGLE, EXECTYPE_TRY } from "@delegation-framework/utils/Constants.sol";
import { YinglongBase } from "../YinglongBase.t.sol";

/// @notice Shared helpers for the coverage suites, on top of the YINGLONG fixture: execution modes, a second
/// DelegationManager (whose address is used as the msg.sender of direct hook calls, to show that state is keyed
/// by the DelegationManager), execution builders, EIP-712 domain recomputation and passkey-signed delegations.
abstract contract CoverageBase is YinglongBase {
    bytes4 internal constant TRANSFER_SEL = 0xa9059cbb;
    bytes4 internal constant TAC_SEL = 0x4000aea0;
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)");
    bytes32 internal constant DH = keccak256("coverage:delegation-hash");

    ModeCode internal singleMode;
    ModeCode internal batchMode;
    ModeCode internal tryMode;
    DelegationManager internal dm2;

    function setUp() public virtual override {
        super.setUp();
        singleMode = ModeLib.encodeSimpleSingle();
        batchMode = ModeLib.encodeSimpleBatch();
        tryMode = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, ModeSelector.wrap(bytes4(0)), ModePayload.wrap(bytes22(0)));
        dm2 = new DelegationManager(makeAddr("dm2-owner"));
    }

    // ------------------------------------------------------------------ executions

    function _tac(address _token, address _to, uint256 _amount, bytes memory _data) internal pure returns (bytes memory) {
        return ExecutionLib.encodeSingle(_token, 0, abi.encodeWithSelector(TAC_SEL, _to, _amount, _data));
    }

    function _instructCall(address _rail, address _payee, uint256 _amount, uint64 _validUntil)
        internal
        pure
        returns (bytes memory)
    {
        return ExecutionLib.encodeSingle(
            _rail,
            0,
            abi.encodeWithSignature(
                "instruct(address,uint256,bytes32,bytes32,uint64)", _payee, _amount, keccak256("purpose"), keccak256("cond"), _validUntil
            )
        );
    }

    // ------------------------------------------------------------------ delegations

    function _hashOf(Delegation memory _d) internal pure returns (bytes32) {
        return EncoderLib._getDelegationHash(_d);
    }

    /// @notice Sign `_d` with Nadia's passkey for the fixture's DelegationManager.
    function _signed(Delegation memory _d) internal view returns (Delegation memory d_) {
        d_ = _d;
        d_.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), _hashOf(_d)));
    }

    function _one(address _enforcer, bytes memory _terms) internal pure returns (Caveat[] memory c_) {
        c_ = new Caveat[](1);
        c_[0] = Caveat(_enforcer, _terms, "");
    }

    function _two(address _e0, bytes memory _t0, address _e1, bytes memory _t1) internal pure returns (Caveat[] memory c_) {
        c_ = new Caveat[](2);
        c_[0] = Caveat(_e0, _t0, "");
        c_[1] = Caveat(_e1, _t1, "");
    }

    // ------------------------------------------------------------------ small arrays

    function _a1(address _x) internal pure returns (address[] memory a_) {
        a_ = new address[](1);
        a_[0] = _x;
    }

    function _a2(address _x, address _y) internal pure returns (address[] memory a_) {
        a_ = new address[](2);
        a_[0] = _x;
        a_[1] = _y;
    }

    function _c1(uint32 _x) internal pure returns (uint32[] memory c_) {
        c_ = new uint32[](1);
        c_[0] = _x;
    }

    function _u1(uint256 _x) internal pure returns (uint256[] memory u_) {
        u_ = new uint256[](1);
        u_[0] = _x;
    }

    // ------------------------------------------------------------------ EIP-712

    /// @notice YINGLONG EIP-712 domain separator recomputed from its definition (name, version "1", chain id,
    /// verifying contract, salt), independently of the contract's own `domainSeparator()`.
    function _domain(string memory _name, address _verifying, bytes32 _salt) internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(_name)), keccak256(bytes("1")), block.chainid, _verifying, _salt)
        );
    }

    function _typed(bytes32 _domainSep, bytes32 _structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", _domainSep, _structHash));
    }

    function _ecdsa(uint256 _key, bytes32 _digest) internal pure returns (bytes memory) {
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(_key, _digest);
        return abi.encodePacked(r_, s_, v_);
    }
}
