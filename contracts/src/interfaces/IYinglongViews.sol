// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @notice Minimal read interfaces the enforcers use, so enforcers never import the registries' code.
interface IPayeeBookView {
    function lookup(address account, address payee) external view returns (bool active, uint32 categoryId);
}

interface IPassportView {
    function walletInfo(address wallet) external view returns (uint256 agentId, uint8 status, bytes32 ownerDidHash);
    function isTrustedAgentWallet(address wallet, address[] calldata trustedIssuers) external view returns (bool);
    function erc8004IdOfWallet(address wallet) external view returns (uint256);
}

interface IKillSwitchView {
    function isPaused(address account, address agent) external view returns (bool);
}

interface IProductRegistryView {
    function productInfo(address product) external view returns (bool listed, uint8 riskClass);
}

interface IRailInfo {
    /// @return 1 = Hong Kong regulated-digital-money test rail, 2 = international test rail,
    /// 3 = coin-free instruction rail
    function railKind() external view returns (uint8);
}

/// @notice ERC-8004 ReputationRegistry (v2.0.0) summary read.
interface IERC8004ReputationView {
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}
