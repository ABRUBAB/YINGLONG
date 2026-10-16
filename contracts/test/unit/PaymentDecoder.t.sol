// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { PaymentDecoder } from "../../src/libraries/PaymentDecoder.sol";
import { ConditionalPaymentInstructions } from "../../src/rails/ConditionalPaymentInstructions.sol";
import { UndecodableExecution, NativeValueNotAllowed } from "../../src/utils/Errors.sol";
import { PaymentDecoderHarness } from "./CoverageMocks.sol";

/// @notice PaymentDecoder: every supported payment shape, and every malformed shape refused with a typed error.
contract PaymentDecoderTest is Test {
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant TAC = 0x4000aea0;
    bytes4 internal constant INSTRUCT = 0xa755512d;

    PaymentDecoderHarness internal h;
    address internal token = makeAddr("token");
    address internal payee = makeAddr("payee");
    address internal rail = makeAddr("rail");

    function setUp() public {
        h = new PaymentDecoderHarness();
    }

    function _exec(address _target, uint256 _value, bytes memory _callData) internal pure returns (bytes memory) {
        return ExecutionLib.encodeSingle(_target, _value, _callData);
    }

    function test_selectorsMatchTheDocumentedValues() public {
        assertEq(bytes4(keccak256("transfer(address,uint256)")), TRANSFER);
        assertEq(bytes4(keccak256("transferAndCall(address,uint256,bytes)")), TAC);
        assertEq(ConditionalPaymentInstructions.instruct.selector, INSTRUCT);
    }

    // ------------------------------------------------------------------ transfer

    function test_transfer_recipientAndBeneficiaryAreTo() public {
        PaymentDecoder.Payment memory p_ = h.decode(_exec(token, 0, abi.encodeWithSelector(TRANSFER, payee, 123)));
        assertEq(p_.asset, token);
        assertEq(p_.recipient, payee);
        assertEq(p_.beneficiary, payee);
        assertEq(p_.amount, 123);
        assertEq(p_.selector, TRANSFER);
    }

    function test_transfer_shortCalldata_reverts() public {
        // 67 bytes: the amount word is one byte short.
        bytes memory cd_ = abi.encodePacked(TRANSFER, bytes32(uint256(uint160(payee))), bytes31(0));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, TRANSFER));
        h.decode(_exec(token, 0, cd_));
    }

    function test_transfer_extraCalldata_reverts() public {
        // 69 bytes: a trailing byte could smuggle data past a decoder that ignores length.
        bytes memory cd_ = abi.encodePacked(abi.encodeWithSelector(TRANSFER, payee, 1), bytes1(0x01));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, TRANSFER));
        h.decode(_exec(token, 0, cd_));
    }

    function test_nativeValue_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(NativeValueNotAllowed.selector, uint256(1)));
        h.decode(_exec(token, 1, abi.encodeWithSelector(TRANSFER, payee, 1)));
    }

    function test_emptyCalldata_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0)));
        h.decode(_exec(token, 0, ""));
    }

    function test_threeByteCalldata_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0)));
        h.decode(_exec(token, 0, hex"a9059c"));
    }

    function test_unknownSelector_reverts() public {
        bytes memory cd_ = abi.encodeWithSignature("approve(address,uint256)", payee, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, bytes4(0x095ea7b3)));
        h.decode(_exec(token, 0, cd_));
    }

    // ------------------------------------------------------------------ transferAndCall

    function test_transferAndCall_emptyData_beneficiaryIsRecipient() public {
        PaymentDecoder.Payment memory p_ = h.decode(_exec(token, 0, abi.encodeWithSelector(TAC, rail, 50, "")));
        assertEq(p_.recipient, rail);
        assertEq(p_.beneficiary, rail);
        assertEq(p_.amount, 50);
        assertEq(p_.selector, TAC);
    }

    function test_transferAndCall_dataShorterThanAWord_beneficiaryIsRecipient() public {
        bytes memory data_ = new bytes(31);
        data_[0] = 0xff;
        PaymentDecoder.Payment memory p_ = h.decode(_exec(token, 0, abi.encodeWithSelector(TAC, rail, 50, data_)));
        assertEq(p_.beneficiary, rail);
    }

    function test_transferAndCall_firstWordIsBeneficiary() public {
        bytes memory data_ = abi.encode(payee, keccak256("condition"), makeAddr("attester"), uint64(9));
        PaymentDecoder.Payment memory p_ = h.decode(_exec(token, 0, abi.encodeWithSelector(TAC, rail, 50, data_)));
        assertEq(p_.asset, token);
        assertEq(p_.recipient, rail);
        assertEq(p_.beneficiary, payee);
        assertEq(p_.amount, 50);
    }

    function test_transferAndCall_exactlyOneWord_isBeneficiary() public {
        PaymentDecoder.Payment memory p_ = h.decode(_exec(token, 0, abi.encodeWithSelector(TAC, rail, 50, abi.encode(payee))));
        assertEq(p_.beneficiary, payee);
    }

    function test_transferAndCall_dirtyBeneficiaryWord_reverts() public {
        bytes memory data_ = abi.encodePacked(bytes32(uint256(uint160(payee)) | (uint256(1) << 160)));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, TAC));
        h.decode(_exec(token, 0, abi.encodeWithSelector(TAC, rail, 50, data_)));
    }

    // ------------------------------------------------------------------ instruct

    function test_instruct_payeeIsRecipientAndBeneficiary() public {
        bytes memory cd_ = abi.encodeWithSelector(INSTRUCT, payee, 900, keccak256("p"), keccak256("c"), uint64(77));
        assertEq(cd_.length, 164);
        PaymentDecoder.Payment memory p_ = h.decode(_exec(rail, 0, cd_));
        assertEq(p_.asset, rail);
        assertEq(p_.recipient, payee);
        assertEq(p_.beneficiary, payee);
        assertEq(p_.amount, 900);
        assertEq(p_.selector, INSTRUCT);
    }

    function test_instruct_wrongLength_reverts() public {
        bytes memory cd_ = abi.encodePacked(abi.encodeWithSelector(INSTRUCT, payee, 900, bytes32(0), bytes32(0), uint64(1)), bytes1(0));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, INSTRUCT));
        h.decode(_exec(rail, 0, cd_));
    }

    // ------------------------------------------------------------------ properties

    function testFuzz_transfer_roundTrip(address _token, address _to, uint256 _amount) public {
        PaymentDecoder.Payment memory p_ = h.decode(_exec(_token, 0, abi.encodeWithSelector(TRANSFER, _to, _amount)));
        assertEq(p_.asset, _token);
        assertEq(p_.recipient, _to);
        assertEq(p_.beneficiary, _to);
        assertEq(p_.amount, _amount);
    }

    function testFuzz_nativeValue_alwaysRefused(uint256 _value) public {
        _value = bound(_value, 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(NativeValueNotAllowed.selector, _value));
        h.decode(_exec(token, _value, abi.encodeWithSelector(TRANSFER, payee, 1)));
    }

    function testFuzz_dirtyBeneficiaryBits_alwaysRefused(address _payee, uint96 _dirt) public {
        _dirt = uint96(bound(_dirt, 1, type(uint96).max));
        bytes memory data_ = abi.encodePacked(bytes32((uint256(_dirt) << 160) | uint256(uint160(_payee))));
        vm.expectRevert(abi.encodeWithSelector(UndecodableExecution.selector, TAC));
        h.decode(_exec(token, 0, abi.encodeWithSelector(TAC, rail, 1, data_)));
    }
}
