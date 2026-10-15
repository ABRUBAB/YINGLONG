// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

// YINGLONG typed errors.
// Every refusal in YINGLONG reverts with one of these errors, so a judge, a regulator or the
// agent itself can attribute a revert to the rule that produced it. The same names appear in the
// TypeScript policy mirror and in the receipts.

error PayeeNotVerified(address payee);
error CategoryBudgetExceeded(uint32 categoryId, uint256 spent, uint256 cap);
error ReserveFloorBreached(address asset, uint256 balanceAfter, uint256 floor);
error VelocityExceeded(uint256 count, uint256 outflow);
error UnsuitableProduct(address product, uint8 riskClass, uint8 maxRiskClass);
error RailNotPermitted(address asset, uint8 profile);
error Paused(address account, address agent);
error CoSignRequired(uint256 amount, uint256 threshold);
error AboveTierCeiling(uint256 amount, uint256 ceiling);
error VetoWindowOpen(uint64 readyAt);
error Vetoed();
error NotScheduled();
error ForbiddenTarget(address target);
error InvalidMandateProof();
error QuoteExpired(uint64 expiry, uint256 nowTimestamp);
error LineageViolation(address redeemer);
error MandateNotLive(bytes32 mandateHash);
error MandateDelegationMismatch(bytes32 mandateHash, bytes32 expected, bytes32 actual);
error ReputationTooLow(uint256 agentId, int256 score, int256 minScore);
error InvalidTerms();
error InvalidArgs();
error InvalidExecutionMode();
error UndecodableExecution(bytes4 selector);
error NativeValueNotAllowed(uint256 value);
error Unauthorized(address caller);
error InvalidSignature();
error SignatureExpired(uint256 deadline);
error NonceAlreadyUsed(uint256 nonce);
