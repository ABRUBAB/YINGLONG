// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { CoverageBase } from "./CoverageBase.sol";
import { UnsuitableProduct, InvalidTerms, InvalidExecutionMode } from "../../src/utils/Errors.sol";

/// @notice SuitabilityEnforcer: a listed product (recipient or beneficiary) must not exceed the sealed risk class.
contract SuitabilityEnforcerTest is CoverageBase {
    function _hook(uint8 _max, bytes memory _exec) internal view {
        suitabilityE.beforeHook(abi.encode(address(products), _max), "", singleMode, _exec, DH, address(nadia), ying);
    }

    function test_getTermsInfo_decodesAndChecksLength() public {
        (address r_, uint8 m_) = suitabilityE.getTermsInfo(abi.encode(address(products), uint8(2)));
        assertEq(r_, address(products));
        assertEq(m_, 2);
        vm.expectRevert(InvalidTerms.selector);
        suitabilityE.getTermsInfo(abi.encode(address(products)));
        bytes memory t_ = abi.encode(address(products));
        vm.expectRevert(InvalidTerms.selector);
        suitabilityE.beforeHook(t_, "", singleMode, _tac(address(tHKD), address(fundLow), 1, ""), DH, address(nadia), ying);
    }

    function test_nonSingleDefaultMode_reverts() public {
        bytes memory t_ = abi.encode(address(products), uint8(2));
        bytes memory e_ = _tac(address(tHKD), address(fundLow), 1, "");
        vm.expectRevert(InvalidExecutionMode.selector);
        suitabilityE.beforeHook(t_, "", tryMode, e_, DH, address(nadia), ying);
    }

    function test_productAtSealedClassPasses_aboveReverts() public {
        _hook(2, _tac(address(tHKD), address(fundLow), 100, "")); // class 2 <= 2
        bytes memory e_ = _tac(address(tHKD), address(fundLow), 100, "");
        vm.expectRevert(abi.encodeWithSelector(UnsuitableProduct.selector, address(fundLow), uint8(2), uint8(1)));
        _hook(1, e_);
        _hook(5, _tac(address(tHKD), address(fundHigh), 100, "")); // class 5 <= 5
    }

    function test_unlistedPayeeIsNotAffected() public {
        _hook(1, _transferCall(address(tHKD), harbourHomes, 100));
    }

    function test_delistedProductIsNotAffected() public {
        products.delist(address(fundHigh));
        _hook(1, _tac(address(tHKD), address(fundHigh), 100, ""));
    }

    function test_productAsBeneficiaryBehindARailIsChecked() public {
        // The first data word names the high-risk fund as beneficiary of an escrow payment.
        bytes memory e_ = _tac(address(tHKD), address(escrow), 100, abi.encode(address(fundHigh), bytes32(0), issuerHbu, uint64(1)));
        vm.expectRevert(abi.encodeWithSelector(UnsuitableProduct.selector, address(fundHigh), uint8(5), uint8(2)));
        _hook(2, e_);
    }

    function test_productAsRecipientIsChecked_whateverTheBeneficiary() public {
        bytes memory e_ = _tac(address(tHKD), address(fundHigh), 100, abi.encode(harbourHomes));
        vm.expectRevert(abi.encodeWithSelector(UnsuitableProduct.selector, address(fundHigh), uint8(5), uint8(2)));
        _hook(2, e_);
    }
}
