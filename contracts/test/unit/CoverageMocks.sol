// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { PaymentDecoder } from "../../src/libraries/PaymentDecoder.sol";

/// @notice Test-only stand-ins used by the coverage suites. None of them is deployed on a ledger.

/// @notice Exposes the PaymentDecoder library so its decoding rules can be asserted directly.
contract PaymentDecoderHarness {
    function decode(bytes calldata _executionCallData) external pure returns (PaymentDecoder.Payment memory) {
        return PaymentDecoder.decode(_executionCallData);
    }
}

/// @notice ERC-8004 ReputationRegistry stand-in with a settable summary per agent id.
contract MockReputationRegistry {
    struct Summary {
        uint64 count;
        int128 value;
        uint8 decimals;
    }

    mapping(uint256 agentId => Summary) public summaries;

    function setSummary(uint256 _agentId, uint64 _count, int128 _value, uint8 _decimals) external {
        summaries[_agentId] = Summary(_count, _value, _decimals);
    }

    function getSummary(uint256 _agentId, address[] calldata, string calldata, string calldata)
        external
        view
        returns (uint64 count_, int128 summaryValue_, uint8 summaryValueDecimals_)
    {
        Summary memory s_ = summaries[_agentId];
        return (s_.count, s_.value, s_.decimals);
    }
}

/// @notice An asset that reports an arbitrary `railKind()` word (to probe JurisdictionEnforcer.railKindOf).
contract MockRailKind {
    uint256 public kindWord;

    constructor(uint256 _kindWord) {
        kindWord = _kindWord;
    }

    function railKind() external view returns (uint256) {
        return kindWord;
    }
}

/// @notice An asset whose every call returns 64 bytes (a malformed `railKind()` answer).
contract MockWideReturn {
    fallback() external {
        assembly {
            mstore(0, 3)
            mstore(32, 3)
            return(0, 64)
        }
    }
}

/// @notice ERC-1363 receiver that answers with the wrong magic value.
contract BadReceiver {
    function onTransferReceived(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}
