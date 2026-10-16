// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { YinglongCreate2Deployer } from "../../src/utils/YinglongCreate2Deployer.sol";
import { PayeeBook } from "../../src/registries/PayeeBook.sol";
import { KillSwitchRegistry } from "../../src/registries/KillSwitchRegistry.sol";

/// @notice YinglongCreate2Deployer: deterministic addresses (computeAddress == the CREATE2 formula == the
/// deployed address), the Deployed event, and DeployFailed on a reused salt or a reverting constructor.
contract YinglongCreate2DeployerTest is Test {
    event Deployed(address indexed addr, bytes32 indexed salt, bytes32 initCodeHash);

    YinglongCreate2Deployer internal factory;

    function setUp() public {
        factory = new YinglongCreate2Deployer();
    }

    function test_deploy_landsAtTheComputedAddressAndEmits() public {
        bytes memory code_ = type(PayeeBook).creationCode;
        bytes32 salt_ = keccak256("YINGLONG/PayeeBook/v1");
        address expected_ = factory.computeAddress(salt_, keccak256(code_));
        assertEq(expected_, vm.computeCreate2Address(salt_, keccak256(code_), address(factory)));
        vm.expectEmit(true, true, true, true, address(factory));
        emit Deployed(expected_, salt_, keccak256(code_));
        address got_ = factory.deploy(salt_, code_);
        assertEq(got_, expected_);
        assertEq(keccak256(got_.code), keccak256(type(PayeeBook).runtimeCode));
    }

    function test_deploy_constructorArgumentsArePartOfTheInitCode() public {
        address sup_ = makeAddr("supervisor");
        bytes memory code_ = abi.encodePacked(type(KillSwitchRegistry).creationCode, abi.encode(sup_, keccak256("YINGLONG-a")));
        address a_ = factory.deploy(bytes32(uint256(1)), code_);
        assertEq(KillSwitchRegistry(a_).supervisor(), sup_);
        assertEq(KillSwitchRegistry(a_).domainSalt(), keccak256("YINGLONG-a"));
        // Same salt, other ledger salt in the constructor: other init code, other address.
        bytes memory other_ = abi.encodePacked(type(KillSwitchRegistry).creationCode, abi.encode(sup_, keccak256("YINGLONG-b")));
        address b_ = factory.deploy(bytes32(uint256(1)), other_);
        assertTrue(a_ != b_);
        assertEq(b_, factory.computeAddress(bytes32(uint256(1)), keccak256(other_)));
    }

    function test_deploy_reusedSalt_reverts() public {
        bytes memory code_ = type(PayeeBook).creationCode;
        factory.deploy(bytes32(0), code_);
        vm.expectRevert(YinglongCreate2Deployer.DeployFailed.selector);
        factory.deploy(bytes32(0), code_);
    }

    function test_deploy_revertingConstructor_reverts() public {
        // PUSH1 0 PUSH1 0 REVERT
        vm.expectRevert(YinglongCreate2Deployer.DeployFailed.selector);
        factory.deploy(bytes32(0), hex"60006000fd");
    }

    function test_addressDependsOnTheFactory() public {
        YinglongCreate2Deployer other_ = new YinglongCreate2Deployer();
        bytes32 h_ = keccak256(type(PayeeBook).creationCode);
        assertTrue(factory.computeAddress(bytes32(0), h_) != other_.computeAddress(bytes32(0), h_));
    }

    function testFuzz_computeAddressMatchesDeploy(bytes32 _salt) public {
        bytes memory code_ = type(PayeeBook).creationCode;
        assertEq(factory.deploy(_salt, code_), factory.computeAddress(_salt, keccak256(code_)));
    }
}
