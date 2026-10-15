// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { CaveatEnforcer } from "@delegation-framework/enforcers/CaveatEnforcer.sol";
import { ModeCode, CallType, ExecType } from "@delegation-framework/utils/Types.sol";
import { CALLTYPE_SINGLE, EXECTYPE_DEFAULT } from "@delegation-framework/utils/Constants.sol";
import { InvalidExecutionMode } from "../utils/Errors.sol";

/// @title YinglongEnforcer
/// @notice Base for every YINGLONG caveat enforcer.
/// Conventions (see docs/TECHNICAL.md, "Enforcer rules"):
///  - terms are signed by the user (trusted); args come from the redeemer (untrusted) and are only used when
///    verified on-chain (signatures, proofs) or merely logged;
///  - only single-call executions in default mode are accepted (try mode would let afterHooks run after a
///    failed execution; batch mode is never granted to an agent);
///  - state is keyed by msg.sender (the DelegationManager), so calling a hook directly cannot touch the
///    counters of a real DelegationManager;
///  - no immutables, so the runtime bytecode is identical on every ledger.
abstract contract YinglongEnforcer is CaveatEnforcer {
    function _requireSingleDefault(ModeCode _mode) internal pure {
        (CallType callType_, ExecType execType_,,) = ModeLib.decode(_mode);
        if (!(callType_ == CALLTYPE_SINGLE) || !(execType_ == EXECTYPE_DEFAULT)) revert InvalidExecutionMode();
    }
}
