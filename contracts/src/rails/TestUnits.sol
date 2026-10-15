// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { YinglongEIP712 } from "../utils/YinglongEIP712.sol";
import { Unauthorized, InvalidSignature, SignatureExpired, NonceAlreadyUsed } from "../utils/Errors.sol";

interface IERC1363Receiver {
    function onTransferReceived(address operator, address from, uint256 value, bytes calldata data) external returns (bytes4);
}

/// @title TestUnits
/// @notice Test units with no monetary value, used for the YINGLONG demonstration rails:
///  - tHKD: "Test units. Simulation of a regulated HKD instrument; not issued by any licensee." (rail kind 1)
///  - tUSD: international test units for the scholarship stipend (rail kind 2)
/// Features: 6 decimals; ERC-1363 `transferAndCall` (so an account can pay an escrow or a quote settlement in
/// one call, without ever granting an ERC-20 approval, which YINGLONG refuses at T4); EIP-3009
/// `transferWithAuthorization` for EOA signers ONLY (ERC-1271 smart-account signatures are deliberately not
/// accepted, closing the signature-based bypass described as KR-15 for our own token).
contract TestUnits is ERC20, YinglongEIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes4 internal constant ERC1363_RECEIVED = 0x88a7ca5c;

    address public minter;
    uint8 public railKind;
    string public label;
    mapping(address authorizer => mapping(bytes32 nonce => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event MinterTransferred(address indexed from, address indexed to);

    error ReceiverRejected(address to);
    error AuthorizationNotYetValid(uint256 validAfter);

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _railKind,
        string memory _label,
        address _minter,
        bytes32 _domainSalt
    )
        ERC20(_name, _symbol)
        YinglongEIP712(_domainSalt)
    {
        railKind = _railKind;
        label = _label;
        minter = _minter;
    }

    function _domainName() internal pure override returns (string memory) {
        return "YINGLONG Test Units";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address _to, uint256 _amount) external {
        if (msg.sender != minter) revert Unauthorized(msg.sender);
        _mint(_to, _amount);
    }

    function transferMinter(address _to) external {
        if (msg.sender != minter) revert Unauthorized(msg.sender);
        emit MinterTransferred(minter, _to);
        minter = _to;
    }

    /// @notice ERC-1363: transfer and notify the receiving contract in one call.
    function transferAndCall(address _to, uint256 _value, bytes calldata _data) external returns (bool) {
        _transfer(msg.sender, _to, _value);
        if (_to.code.length == 0) revert ReceiverRejected(_to);
        bytes4 ret_ = IERC1363Receiver(_to).onTransferReceived(msg.sender, msg.sender, _value, _data);
        if (ret_ != ERC1363_RECEIVED) revert ReceiverRejected(_to);
        return true;
    }

    /// @notice EIP-3009 transfer by authorization; EOA (ECDSA) signatures only.
    function transferWithAuthorization(
        address _from,
        address _to,
        uint256 _value,
        uint256 _validAfter,
        uint256 _validBefore,
        bytes32 _nonce,
        bytes calldata _signature
    )
        external
    {
        if (block.timestamp <= _validAfter) revert AuthorizationNotYetValid(_validAfter);
        if (block.timestamp >= _validBefore) revert SignatureExpired(_validBefore);
        if (authorizationState[_from][_nonce]) revert NonceAlreadyUsed(uint256(_nonce));
        bytes32 digest_ = _hashTypedData(
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, _from, _to, _value, _validAfter, _validBefore, _nonce))
        );
        (address signer_, ECDSA.RecoverError err_,) = ECDSA.tryRecover(digest_, _signature);
        if (err_ != ECDSA.RecoverError.NoError || signer_ != _from || _from.code.length != 0) revert InvalidSignature();
        authorizationState[_from][_nonce] = true;
        emit AuthorizationUsed(_from, _nonce);
        _transfer(_from, _to, _value);
    }
}
