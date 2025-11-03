// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Your token contract is in CampusCreditV3.sol, but the contract itself is named BankMintToken
import {BankMintToken} from "./CampusCreditV3.sol";
import {Test} from "forge-std/Test.sol";

contract BankMintTokenTest is Test {
    BankMintToken internal token;

    address internal admin; // this test contract after deploy
    address internal minter;
    uint256 internal minterPk;

    address internal pauser;
    uint256 internal pauserPk;

    address internal endorser;
    uint256 internal endorserPk;

    address internal attacker;
    uint256 internal attackerPk;

    address internal user1;
    uint256 internal user1Pk;

    // constants copied from your token
    bytes32 internal constant ACTION_MINT    = keccak256("MINT");
    bytes32 internal constant ACTION_AIRDROP = keccak256("AIRDROP");

    // must match contract’s ACTION_TYPEHASH
    // keccak256("Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)")
    bytes32 internal constant ACTION_TYPEHASH =
        keccak256(
            "Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
        );

    uint256 internal capAmount;
    uint256 internal initialMintAmount;

    function setUp() public {
        (minter,   minterPk)   = makeAddrAndKey("MINTER");
        (pauser,   pauserPk)   = makeAddrAndKey("PAUSER");
        (endorser, endorserPk) = makeAddrAndKey("ENDORSER");
        (attacker, attackerPk) = makeAddrAndKey("ATTACKER");
        (user1,    user1Pk)    = makeAddrAndKey("USER1");

        vm.deal(minter,   100 ether);
        vm.deal(pauser,   100 ether);
        vm.deal(endorser, 100 ether);
        vm.deal(attacker, 100 ether);
        vm.deal(user1,    100 ether);

        capAmount         = 1_000_000 * 1e18;
        initialMintAmount = 1_000 * 1e18;

        // deploy token; msg.sender = this contract
        token = new BankMintToken(
            "CampusCreditV3",
            "CCV3",
            capAmount,
            address(this),        // initialReceiver
            initialMintAmount
        );

        admin = address(this);

        // delegate roles
        token.grantRole(token.MINTER_ROLE(),   minter);
        token.grantRole(token.PAUSER_ROLE(),   pauser);
        token.grantRole(token.ENDORSER_ROLE(), endorser);
    }

    // ---------- Minimal helpers we still need ----------

    function _domainSeparator() internal view returns (bytes32) {
        // must match EIP712("BankMintToken-Endorsement","1") in constructor
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("BankMintToken-Endorsement")),
                keccak256(bytes("1")),
                block.chainid,
                address(token)
            )
        );
    }

    function _structHash(
        address caller,
        bytes32 actionId,
        bytes32 payloadHash,
        uint256 nonce,
        uint256 deadline
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                caller,
                actionId,
                payloadHash,
                nonce,
                deadline
            )
        );
    }

    function _digest(
        address caller,
        bytes32 actionId,
        bytes32 payloadHash,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 ds = _domainSeparator();
        bytes32 sh = _structHash(caller, actionId, payloadHash, nonce, deadline);
        return keccak256(abi.encodePacked("\x19\x01", ds, sh));
    }

    // payload hash for mintEndorsed(): keccak256(abi.encode(to, amount))
    function _mintPayloadHash(address to, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(to, amount));
    }

    // sign using forge-std cheatcode vm.sign(pk, digest)
    function _signDigest(uint256 pk, bytes32 dig) internal returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, dig);
        sig = abi.encodePacked(r, s, v); // r||s||v, 65 bytes
    }

    // Build an endorsement for mintEndorsed()
    function _endorseMint(
        address caller,
        address to,
        uint256 amount,
        uint256 deadline,
        uint256 signerPk
    ) internal returns (bytes memory sig) {
        uint256 nonce = token.nonces(caller);
        bytes32 payloadHash = _mintPayloadHash(to, amount);
        bytes32 dig = _digest(caller, ACTION_MINT, payloadHash, nonce, deadline);
        sig = _signDigest(signerPk, dig);
    }

    // ---------- TESTS ----------

    function testInitialSetup() public {
        // metadata / cap
        assertEq(token.name(), "CampusCreditV3");
        assertEq(token.symbol(), "CCV3");
        assertEq(token.cap(), capAmount);

        // initial mint to admin
        assertEq(token.totalSupply(), initialMintAmount);
        assertEq(token.balanceOf(admin), initialMintAmount);

        // constructor gave this contract ALL roles
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(token.hasRole(token.MINTER_ROLE(), admin));
        assertTrue(token.hasRole(token.PAUSER_ROLE(), admin));
        assertTrue(token.hasRole(token.ENDORSER_ROLE(), admin));

        // setUp() granted roles to named actors
        assertTrue(token.hasRole(token.MINTER_ROLE(), minter));
        assertTrue(token.hasRole(token.PAUSER_ROLE(), pauser));
        assertTrue(token.hasRole(token.ENDORSER_ROLE(), endorser));

        // attacker has none
        assertFalse(token.hasRole(token.MINTER_ROLE(), attacker));
        assertFalse(token.hasRole(token.PAUSER_ROLE(), attacker));
        assertFalse(token.hasRole(token.ENDORSER_ROLE(), attacker));
    }

    function testPauseAndUnpause() public {
        // attacker CANNOT pause
        vm.prank(attacker);
        vm.expectRevert(); // OZ AccessControlUnauthorizedAccount
        token.pause();

        // pauser CAN pause
        vm.prank(pauser);
        token.pause();

        // while paused: transfer() should revert with EnforcedPause()
        vm.expectRevert(bytes4(keccak256("EnforcedPause()")));
        token.transfer(user1, 1);

        // attacker CANNOT unpause
        vm.prank(attacker);
        vm.expectRevert();
        token.unpause();

        // pauser CAN unpause
        vm.prank(pauser);
        token.unpause();

        // after unpause, transfer works
        bool ok = token.transfer(user1, 1);
        assertTrue(ok);
        assertEq(token.balanceOf(user1), 1);
    }

    function testMintOnlyMinterAndCap() public {
        // attacker cannot mint
        vm.prank(attacker);
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        token.mint(attacker, 123);

        // minter can mint
        vm.prank(minter);
        token.mint(attacker, 123);
        assertEq(token.balanceOf(attacker), 123);

        // consume remaining cap
        uint256 supplyNow = token.totalSupply();
        uint256 remaining = capAmount - supplyNow;

        // mint up to remaining works
        vm.prank(minter);
        token.mint(attacker, remaining);

        // trying to mint past cap must revert (reason can be OZ revert string
        // or your custom CapExceeded in some edge accounting paths)
        vm.prank(minter);
        vm.expectRevert();
        token.mint(attacker, 1);
    }

    function testMintEndorsedHappyPath() public {
        uint256 amt = 500e18;
        uint256 deadline = block.timestamp + 3600;

        // off-chain sig from ENDORSER_ROLE for caller = minter
        bytes memory sig = _endorseMint(minter, user1, amt, deadline, endorserPk);

        // minter calls mintEndorsed()
        vm.prank(minter);
        token.mintEndorsed(user1, amt, deadline, sig);

        assertEq(token.balanceOf(user1), amt);
    }

    function testMintEndorsedExpiredReverts() public {
        uint256 amt = 10e18;
        uint256 pastDeadline = block.timestamp - 1; // already expired

        bytes memory sig = _endorseMint(minter, user1, amt, pastDeadline, endorserPk);

        vm.prank(minter);
        vm.expectRevert(BankMintToken.EndorsementExpired.selector);
        token.mintEndorsed(user1, amt, pastDeadline, sig);
    }

    function testMintEndorsedWrongSignerReverts() public {
        uint256 amt = 10e18;
        uint256 deadline = block.timestamp + 3600;

        // attacker (NOT ENDORSER_ROLE) signs
        bytes memory sig = _endorseMint(minter, user1, amt, deadline, attackerPk);

        vm.prank(minter);
        vm.expectRevert(BankMintToken.EndorsementBadSigner.selector);
        token.mintEndorsed(user1, amt, deadline, sig);
    }

    function testMintEndorsedReplayFailsViaNonce() public {
        uint256 amt = 9e18;
        uint256 deadline = block.timestamp + 3600;

        // build sig using current nonce (0)
        bytes memory sig = _endorseMint(minter, user1, amt, deadline, endorserPk);

        // first call works
        vm.prank(minter);
        token.mintEndorsed(user1, amt, deadline, sig);

        // replay the SAME sig should fail since nonce incremented
        vm.prank(minter);
        vm.expectRevert(BankMintToken.EndorsementBadSigner.selector);
        token.mintEndorsed(user1, amt, deadline, sig);
    }
}