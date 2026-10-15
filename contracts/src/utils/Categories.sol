// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

/// @title Categories
/// @notice Budget category ids shared by PayeeBook entries, CategoryBudgetEnforcer, CoSignEnforcer and the
/// TypeScript mandate compiler (packages/mandate/src/categories.ts must match).
library Categories {
    uint32 internal constant RENT = 1;
    uint32 internal constant FOOD = 2;
    uint32 internal constant TUITION = 3;
    uint32 internal constant TRANSPORT = 4;
    uint32 internal constant UTILITIES = 5;
    uint32 internal constant SUPPLIER = 6;
    uint32 internal constant PAYROLL = 7;
    uint32 internal constant SERVICES = 8;
    uint32 internal constant TREASURY = 9;
    uint32 internal constant OTHER = 10;
}
