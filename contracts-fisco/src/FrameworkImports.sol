// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

// Pulls the MetaMask Delegation Framework v1.3.0 contracts (and the ERC-4337 EntryPoint v0.7 and
// ERC1967Proxy they depend on) into this project's build, so `forge build` emits artifacts for
// them from the unmodified submodule sources. Nothing here is deployed by itself.

import { EntryPoint } from "@account-abstraction/core/EntryPoint.sol";
import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { HybridDeleGator } from "@delegation-framework/HybridDeleGator.sol";
import { MultiSigDeleGator } from "@delegation-framework/MultiSigDeleGator.sol";
import { AllowedTargetsEnforcer } from "@delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import { AllowedMethodsEnforcer } from "@delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import { ValueLteEnforcer } from "@delegation-framework/enforcers/ValueLteEnforcer.sol";
import { TimestampEnforcer } from "@delegation-framework/enforcers/TimestampEnforcer.sol";
import { LimitedCallsEnforcer } from "@delegation-framework/enforcers/LimitedCallsEnforcer.sol";
import { NonceEnforcer } from "@delegation-framework/enforcers/NonceEnforcer.sol";
import { RedeemerEnforcer } from "@delegation-framework/enforcers/RedeemerEnforcer.sol";
import { ERC20TransferAmountEnforcer } from "@delegation-framework/enforcers/ERC20TransferAmountEnforcer.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Imported so the probe contracts are built with the same profile.
import { FiscoProbe, ProbeChild, ProbeP256 } from "../probe/FiscoProbe.sol";
