// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { EntryPoint } from "@account-abstraction/core/EntryPoint.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { FCL_ecdsa_utils } from "@FCL/FCL_ecdsa_utils.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

import { DelegationManager } from "@delegation-framework/DelegationManager.sol";
import { HybridDeleGator } from "@delegation-framework/HybridDeleGator.sol";
import { EncoderLib } from "@delegation-framework/libraries/EncoderLib.sol";
import { P256SCLVerifierLib } from "@delegation-framework/libraries/P256SCLVerifierLib.sol";
import { Delegation, Caveat, ModeCode } from "@delegation-framework/utils/Types.sol";
import { AllowedTargetsEnforcer } from "@delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import { AllowedMethodsEnforcer } from "@delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import { ValueLteEnforcer } from "@delegation-framework/enforcers/ValueLteEnforcer.sol";
import { LimitedCallsEnforcer } from "@delegation-framework/enforcers/LimitedCallsEnforcer.sol";
import { ERC20TransferAmountEnforcer } from "@delegation-framework/enforcers/ERC20TransferAmountEnforcer.sol";
import { SCL_Wrapper } from "../lib/delegation-framework/test/utils/SCLWrapperLib.sol";

import { PayeeBook } from "../src/registries/PayeeBook.sol";
import { MandateRegistry } from "../src/registries/MandateRegistry.sol";
import { KillSwitchRegistry } from "../src/registries/KillSwitchRegistry.sol";
import { YinglongPassportRegistry } from "../src/registries/YinglongPassportRegistry.sol";
import { AccountabilityLedger } from "../src/registries/AccountabilityLedger.sol";
import { MandateBindingEnforcer } from "../src/enforcers/MandateBindingEnforcer.sol";
import { ForbiddenTargetsEnforcer } from "../src/enforcers/ForbiddenTargetsEnforcer.sol";
import { AgentLineageEnforcer } from "../src/enforcers/AgentLineageEnforcer.sol";
import { VerifiedPayeeEnforcer } from "../src/enforcers/VerifiedPayeeEnforcer.sol";
import { CategoryBudgetEnforcer } from "../src/enforcers/CategoryBudgetEnforcer.sol";
import { ReserveFloorEnforcer } from "../src/enforcers/ReserveFloorEnforcer.sol";
import { VelocityEnforcer } from "../src/enforcers/VelocityEnforcer.sol";
import { SuitabilityEnforcer } from "../src/enforcers/SuitabilityEnforcer.sol";
import { JurisdictionEnforcer } from "../src/enforcers/JurisdictionEnforcer.sol";
import { GlobalPauseEnforcer } from "../src/enforcers/GlobalPauseEnforcer.sol";
import { ReputationGateEnforcer } from "../src/enforcers/ReputationGateEnforcer.sol";
import { CoSignEnforcer } from "../src/enforcers/CoSignEnforcer.sol";
import { VetoTimelockEnforcer } from "../src/enforcers/VetoTimelockEnforcer.sol";
import { TestUnits } from "../src/rails/TestUnits.sol";
import { ProductRegistry } from "../src/rails/ProductRegistry.sol";
import { TestMoneyMarketFund } from "../src/rails/TestMoneyMarketFund.sol";
import { ProtectedPayment } from "../src/rails/ProtectedPayment.sol";
import { SignedQuoteSettlement } from "../src/rails/SignedQuoteSettlement.sol";
import { ConditionalPaymentInstructions } from "../src/rails/ConditionalPaymentInstructions.sol";
import { Categories } from "../src/utils/Categories.sol";

/// @notice Shared fixture: the framework (EntryPoint, DelegationManager, HybridDeleGator), every YINGLONG
/// registry, enforcer and rail, Nadia's passkey account (owner = address(0), one P-256 key), her agent Ying
/// with a passport, her payee book and her sealed Hong Kong mandate.
abstract contract YinglongBase is Test {
    bytes32 internal constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    bytes32 internal constant SALT = keccak256("YINGLONG-test");
    uint256 internal constant U = 1e6; // one test unit (6 decimals)
    uint256 internal constant P256_N = 115792089210356248762697446949407573529996955224135760342422259061068512044369;

    EntryPoint internal entryPoint;
    DelegationManager internal dm;
    HybridDeleGator internal hybridImpl;

    PayeeBook internal payeeBook;
    MandateRegistry internal mandates;
    KillSwitchRegistry internal killSwitch;
    YinglongPassportRegistry internal passports;
    AccountabilityLedger internal ledger;
    ProductRegistry internal products;

    AllowedTargetsEnforcer internal allowedTargets;
    AllowedMethodsEnforcer internal allowedMethods;
    ValueLteEnforcer internal valueLte;
    LimitedCallsEnforcer internal limitedCalls;
    ERC20TransferAmountEnforcer internal transferAmount;
    MandateBindingEnforcer internal bindingE;
    ForbiddenTargetsEnforcer internal forbiddenE;
    AgentLineageEnforcer internal lineageE;
    VerifiedPayeeEnforcer internal payeeE;
    CategoryBudgetEnforcer internal budgetE;
    ReserveFloorEnforcer internal floorE;
    VelocityEnforcer internal velocityE;
    SuitabilityEnforcer internal suitabilityE;
    JurisdictionEnforcer internal jurisdictionE;
    GlobalPauseEnforcer internal pauseE;
    ReputationGateEnforcer internal reputationE;
    CoSignEnforcer internal cosignE;
    VetoTimelockEnforcer internal vetoE;

    TestUnits internal tHKD;
    TestUnits internal tUSD;
    TestMoneyMarketFund internal fundLow;
    TestMoneyMarketFund internal fundHigh;
    ProtectedPayment internal escrow;
    SignedQuoteSettlement internal quotes;
    ConditionalPaymentInstructions internal cpi;

    // people and agents
    uint256 internal nadiaPasskey; // P-256 private key of Nadia's phone passkey
    string internal constant NADIA_KEY_ID = "nadia-phone";
    HybridDeleGator internal nadia; // Nadia's smart account
    address internal ying; // her agent's wallet
    uint256 internal yingKey;
    address internal agentOwner; // passport controller key
    uint256 internal yingAgentId;
    address internal supervisor;
    address internal guardian;
    address internal mirage;
    uint256 internal mirageKey;
    address internal harbourHomes;
    address internal hbuBursar;
    address internal foodMart;
    address internal issuerHbu;
    address internal issuerBank;
    address internal pearlRiver;
    uint256 internal pearlRiverKey;
    bytes32 internal nadiaDid;

    function setUp() public virtual {
        entryPoint = new EntryPoint();
        supervisor = makeAddr("supervisor");
        dm = new DelegationManager(makeAddr("dm-owner"));
        vm.etch(P256SCLVerifierLib.VERIFIER, type(SCL_Wrapper).runtimeCode);
        hybridImpl = new HybridDeleGator(dm, entryPoint);

        killSwitch = new KillSwitchRegistry(supervisor, SALT);
        payeeBook = new PayeeBook();
        mandates = new MandateRegistry(address(killSwitch));
        passports = new YinglongPassportRegistry(supervisor, SALT);
        ledger = new AccountabilityLedger(address(this));
        products = new ProductRegistry(address(this));

        allowedTargets = new AllowedTargetsEnforcer();
        allowedMethods = new AllowedMethodsEnforcer();
        valueLte = new ValueLteEnforcer();
        limitedCalls = new LimitedCallsEnforcer();
        transferAmount = new ERC20TransferAmountEnforcer();
        bindingE = new MandateBindingEnforcer();
        forbiddenE = new ForbiddenTargetsEnforcer();
        lineageE = new AgentLineageEnforcer();
        payeeE = new VerifiedPayeeEnforcer();
        budgetE = new CategoryBudgetEnforcer();
        floorE = new ReserveFloorEnforcer();
        velocityE = new VelocityEnforcer();
        suitabilityE = new SuitabilityEnforcer();
        jurisdictionE = new JurisdictionEnforcer();
        pauseE = new GlobalPauseEnforcer();
        reputationE = new ReputationGateEnforcer();
        cosignE = new CoSignEnforcer(SALT);
        vetoE = new VetoTimelockEnforcer(SALT);

        tHKD = new TestUnits("Test HKD units", "tHKD", 1, "Test units. Simulation of a regulated HKD instrument.", address(this), SALT);
        tUSD = new TestUnits("Test USD units", "tUSD", 2, "Test units. International test rail.", address(this), SALT);
        fundLow = new TestMoneyMarketFund("Test Money Market Fund (low risk)", "tMMF", address(tHKD));
        fundHigh = new TestMoneyMarketFund("Test Growth Fund (high risk)", "tGRW", address(tHKD));
        products.list(address(fundLow), 2, keccak256("tMMF"));
        products.list(address(fundHigh), 5, keccak256("tGRW"));
        escrow = new ProtectedPayment();
        quotes = new SignedQuoteSettlement(SALT);
        cpi = new ConditionalPaymentInstructions(address(this));

        (ying, yingKey) = makeAddrAndKey("ying");
        (mirage, mirageKey) = makeAddrAndKey("mirage");
        (pearlRiver, pearlRiverKey) = makeAddrAndKey("pearl-river-fx");
        agentOwner = makeAddr("agent-owner");
        guardian = makeAddr("guardian");
        harbourHomes = makeAddr("harbour-homes");
        hbuBursar = makeAddr("hbu-bursar");
        foodMart = makeAddr("food-mart");
        issuerHbu = makeAddr("issuer-hbu");
        issuerBank = makeAddr("issuer-harbour-digital-bank");

        // Nadia's passkey account: owner = address(0), one P-256 key.
        nadiaPasskey = uint256(keccak256("nadia passkey seed")) % P256_N;
        (uint256 x_, uint256 y_) = FCL_ecdsa_utils.ecdsa_derivKpub(nadiaPasskey);
        string[] memory ids_ = new string[](1);
        uint256[] memory xs_ = new uint256[](1);
        uint256[] memory ys_ = new uint256[](1);
        ids_[0] = NADIA_KEY_ID;
        xs_[0] = x_;
        ys_[0] = y_;
        nadia = HybridDeleGator(
            payable(
                address(
                    new ERC1967Proxy(
                        address(hybridImpl),
                        abi.encodeWithSignature("initialize(address,string[],uint256[],uint256[])", address(0), ids_, xs_, ys_)
                    )
                )
            )
        );
        nadiaDid = keccak256(abi.encodePacked("did:pkh:eip155:31337:", vm.toString(address(nadia))));

        // Ying's passport, controlled by a dedicated owner key, attested by the university and the bank.
        yingAgentId = _registerPassport(ying, yingKey, nadiaDid, "YL-TEST-0001");
        vm.prank(issuerHbu);
        passports.attest(yingAgentId, keccak256("agent of an enrolled HBU student"), 0);

        // Pearl River FX desk: an attested service agent (not in Nadia's payee book).
        uint256 deskId_ = _registerPassport(pearlRiver, pearlRiverKey, keccak256("did:web:pearl-river-fx.example"), "YL-TEST-0101");
        vm.prank(issuerBank);
        passports.attest(deskId_, keccak256("KYB-verified FX desk"), 0);

        // Nadia's payee book (T3: written by her own account).
        vm.startPrank(address(nadia));
        payeeBook.setPayee(harbourHomes, Categories.RENT, keccak256("Harbour Homes"));
        payeeBook.setPayee(hbuBursar, Categories.TUITION, keccak256("HBU Bursar"));
        payeeBook.setPayee(foodMart, Categories.FOOD, keccak256("Kowloon Food Mart"));
        payeeBook.setPayee(address(fundLow), Categories.TREASURY, keccak256("Test Money Market Fund"));
        payeeBook.setPayee(address(fundHigh), Categories.TREASURY, keccak256("Test Growth Fund"));
        killSwitch.setGuardian(guardian, true);
        vm.stopPrank();

        tHKD.mint(address(nadia), 20_000 * U);
        tUSD.mint(address(nadia), 3_000 * U);
    }

    // ------------------------------------------------------------------ helpers

    function _registerPassport(address _wallet, uint256 _walletKey, bytes32 _did, string memory _code)
        internal
        returns (uint256 id_)
    {
        uint256 next_ = passports.nextAgentId();
        uint256 deadline_ = block.timestamp + 1 hours;
        bytes32 digest_ = passports.bindWalletDigest(next_, agentOwner, _wallet, deadline_);
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(_walletKey, digest_);
        YinglongPassportRegistry.RegisterParams memory p_ = YinglongPassportRegistry.RegisterParams({
            agentWallet: _wallet,
            ownerDidHash: _did,
            passportVcHash: keccak256("vc"),
            provenanceHash: keccak256("provenance"),
            enforcerTableHash: keccak256("enforcers"),
            jwksHash: keccak256("jwks"),
            erc8004AgentId: 0,
            identityCode: _code,
            kid: "card-key-1",
            registrationURI: "https://api.yinglong-agent.tech/agents/registration.json",
            deadline: deadline_,
            walletSig: abi.encodePacked(r_, s_, v_)
        });
        vm.prank(agentOwner);
        id_ = passports.register(p_);
    }

    /// @notice Raw P-256 signature in the HybridDeleGator format (keyIdHash, r, s), signed by Nadia's passkey.
    function _passkeySign(bytes32 _hash) internal pure returns (bytes memory) {
        uint256 pk_ = uint256(keccak256("nadia passkey seed")) % P256_N;
        (bytes32 r_, bytes32 s_) = vm.signP256(pk_, sha256(abi.encodePacked(_hash)));
        if (uint256(s_) > P256SCLVerifierLib.P256_N_DIV_2) s_ = bytes32(P256_N - uint256(s_));
        return abi.encodePacked(keccak256(abi.encodePacked(NADIA_KEY_ID)), r_, s_);
    }

    function _packAddrs(address[] memory _a) internal pure returns (bytes memory out_) {
        for (uint256 i; i < _a.length; ++i) {
            out_ = abi.encodePacked(out_, _a[i]);
        }
    }

    function _forbiddenList() internal view returns (bytes memory) {
        address[] memory f_ = new address[](8);
        f_[0] = address(dm);
        f_[1] = address(entryPoint);
        f_[2] = address(payeeBook);
        f_[3] = address(mandates);
        f_[4] = address(killSwitch);
        f_[5] = address(passports);
        f_[6] = address(ledger);
        f_[7] = address(products);
        return _packAddrs(f_);
    }

    uint256 internal constant COSIGN_IDX = 9;

    /// @notice Nadia's Hong Kong mandate: "Rent 9,500 tHKD to Harbour Homes on the 1st; food under 3,000;
    /// never below 1,500; tuition deposit to HBU; ask above 2,000 or for anyone new; sweep idle cash only into
    /// low-risk products."
    function _nadiaCaveats(bytes32 _mandateHash, uint8 _profile) internal view returns (Caveat[] memory c_) {
        c_ = new Caveat[](15);
        address[] memory targets_ = new address[](2);
        targets_[0] = address(tHKD);
        targets_[1] = address(tUSD);
        c_[0] = Caveat(address(allowedTargets), _packAddrs(targets_), "");
        c_[1] = Caveat(
            address(allowedMethods), abi.encodePacked(bytes4(0xa9059cbb), bytes4(0x4000aea0)), ""
        );
        c_[2] = Caveat(address(valueLte), abi.encode(uint256(0)), "");
        c_[3] = Caveat(address(forbiddenE), _forbiddenList(), "");
        c_[4] = Caveat(address(pauseE), abi.encode(address(killSwitch), address(passports)), "");
        c_[5] = Caveat(address(lineageE), abi.encode(address(passports), nadiaDid, address(0)), "");
        c_[6] = Caveat(address(bindingE), abi.encode(address(mandates), _mandateHash), "");
        c_[7] = Caveat(address(jurisdictionE), abi.encode(_profile, targets_), "");

        address[] memory issuers_ = new address[](2);
        issuers_[0] = issuerHbu;
        issuers_[1] = issuerBank;
        address[] memory intermediaries_ = new address[](2);
        intermediaries_[0] = address(escrow);
        intermediaries_[1] = address(quotes);
        c_[8] = Caveat(address(payeeE), abi.encode(address(payeeBook), address(passports), issuers_, intermediaries_), "");

        uint32[] memory cats_ = new uint32[](5);
        uint256[] memory caps_ = new uint256[](5);
        (cats_[0], caps_[0]) = (Categories.RENT, 9_500 * U);
        (cats_[1], caps_[1]) = (Categories.FOOD, 3_000 * U);
        (cats_[2], caps_[2]) = (Categories.TUITION, 12_000 * U);
        (cats_[3], caps_[3]) = (Categories.TREASURY, 5_000 * U);
        (cats_[4], caps_[4]) = (Categories.SERVICES, 200 * U);
        c_[10] = Caveat(
            address(budgetE),
            abi.encode(address(payeeBook), address(tHKD), uint64(0), uint64(30 days), Categories.SERVICES, cats_, caps_),
            ""
        );

        uint32[] memory t1Cats_ = new uint32[](1);
        uint256[] memory t1Caps_ = new uint256[](1);
        (t1Cats_[0], t1Caps_[0]) = (Categories.RENT, 9_500 * U);
        c_[9] = Caveat(
            address(cosignE),
            abi.encode(
                address(payeeBook), address(tHKD), 2_000 * U, 50 * U, 12_000 * U, uint256(10 minutes), t1Cats_, t1Caps_
            ),
            ""
        );
        c_[11] = Caveat(address(floorE), abi.encode(address(tHKD), 1_500 * U), "");
        c_[12] = Caveat(address(velocityE), abi.encode(address(tHKD), uint64(1 days), uint32(8), 15_000 * U), "");
        c_[13] = Caveat(address(suitabilityE), abi.encode(address(products), uint8(2)), "");
        // Same rules for the tUSD stipend balance: small budget, services only.
        uint32[] memory usdCats_ = new uint32[](1);
        uint256[] memory usdCaps_ = new uint256[](1);
        (usdCats_[0], usdCaps_[0]) = (Categories.SERVICES, 2_500 * U);
        c_[14] = Caveat(
            address(budgetE),
            abi.encode(address(payeeBook), address(tUSD), uint64(0), uint64(30 days), Categories.SERVICES, usdCats_, usdCaps_),
            ""
        );
    }

    function _delegation(address _delegator, address _delegate, Caveat[] memory _caveats, uint256 _salt)
        internal
        pure
        returns (Delegation memory)
    {
        return Delegation({
            delegate: _delegate,
            delegator: _delegator,
            authority: ROOT_AUTHORITY,
            caveats: _caveats,
            salt: _salt,
            signature: ""
        });
    }

    /// @notice Nadia seals a mandate: publish in MandateRegistry (from her account) and sign with her passkey.
    function _sealNadia(bytes32 _mandateHash, uint8 _profile, uint256 _salt) internal returns (Delegation memory d_) {
        Caveat[] memory caveats_ = _nadiaCaveats(_mandateHash, _profile);
        d_ = _delegation(address(nadia), ying, caveats_, _salt);
        MandateRegistry.PublishParams memory p_ = MandateRegistry.PublishParams({
            mandateHash: _mandateHash,
            agent: ying,
            lineageId: keccak256("nadia-daily"),
            jurisdiction: _profile,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 365 days),
            salt: _salt,
            caveats: caveats_
        });
        vm.prank(address(nadia));
        mandates.publish(p_);
        d_.signature = _passkeySign(MessageHashUtils.toTypedDataHash(dm.getDomainHash(), EncoderLib._getDelegationHash(d_)));
    }

    function _transferCall(address _token, address _to, uint256 _amount) internal pure returns (bytes memory) {
        return ExecutionLib.encodeSingle(_token, 0, abi.encodeWithSelector(bytes4(0xa9059cbb), _to, _amount));
    }

    function _redeem(address _redeemer, Delegation memory _d, bytes memory _execution) internal {
        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = _d;
        _redeemChain(_redeemer, chain_, _execution);
    }

    function _redeemChain(address _redeemer, Delegation[] memory _chain, bytes memory _execution) internal {
        bytes[] memory contexts_ = new bytes[](1);
        contexts_[0] = abi.encode(_chain);
        ModeCode[] memory modes_ = new ModeCode[](1);
        modes_[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory executions_ = new bytes[](1);
        executions_[0] = _execution;
        vm.prank(_redeemer);
        dm.redeemDelegations(contexts_, modes_, executions_);
    }
}
