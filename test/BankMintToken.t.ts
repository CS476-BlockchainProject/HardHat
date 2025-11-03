import { expect } from "chai";
import { keccak256, encodeAbiParameters, parseAbiParameters, toBytes, toHex } from "viem";
import { getAddress } from "viem/utils";
import hre from "hardhat";

// convenience aliases from hardhat-viem
const { viem } = hre;

describe("BankMintToken (CampusCreditV3)", () => {
  // --- constants mirrored from the contract ---
  const ACTION_MINT    = keccak256(toBytes("MINT"));
  const ACTION_AIRDROP = keccak256(toBytes("AIRDROP"));

  // matches solidity:
  // keccak256("Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)")
  const ACTION_TYPEHASH = keccak256(
    toBytes(
      "Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
    )
  );

  async function deployFixture() {
    // get 4 signers
    const [deployer, minter, pauser, endorser, rando] = await viem.getWalletClients();

    // deploy the token
    const cap = 1_000_000n * 10n ** 18n; // 1M tokens (18 decimals)
    const initialMint = 1000n * 10n ** 18n;
    const initialReceiver = await deployer.getAddress();

    const token = await viem.deployContract("BankMintToken", [
      "CampusCreditV3",
      "CCV3",
      cap,
      initialReceiver,
      initialMint,
    ]);

    const publicClient = await viem.getPublicClient();

    // Role identifiers (must match contract; keccak256("ROLE"))
    const MINTER_ROLE   = keccak256(toBytes("MINTER_ROLE"));
    const PAUSER_ROLE   = keccak256(toBytes("PAUSER_ROLE"));
    const ENDORSER_ROLE = keccak256(toBytes("ENDORSER_ROLE"));
    const DEFAULT_ADMIN_ROLE =
      "0x0000000000000000000000000000000000000000000000000000000000000000";

    // By default constructor only grants all roles to deployer.
    // We'll explicitly grant MINTER_ROLE, PAUSER_ROLE, ENDORSER_ROLE to others to simulate real usage.
    await token.write.grantRole([MINTER_ROLE, await minter.getAddress()], { account: deployer.account });
    await token.write.grantRole([PAUSER_ROLE, await pauser.getAddress()], { account: deployer.account });
    await token.write.grantRole([ENDORSER_ROLE, await endorser.getAddress()], { account: deployer.account });

    return {
      token,
      publicClient,
      deployer,
      minter,
      pauser,
      endorser,
      rando,
      cap,
      initialMint,
      roles: {
        MINTER_ROLE,
        PAUSER_ROLE,
        ENDORSER_ROLE,
        DEFAULT_ADMIN_ROLE,
      },
    };
  }

  //
  // Helper: build and sign an endorsement for mint/airdrop
  //
  async function signAction({
    token,
    endorser,        // walletClient that holds ENDORSER_ROLE
    caller,          // address of on-chain caller (the MINTER doing mintEndorsed/airdropEndorsed)
    actionId,        // ACTION_MINT or ACTION_AIRDROP
    payloadHash,     // bytes32
    deadline,        // bigint timestamp
  }: {
    token: any;
    endorser: any;
    caller: `0x${string}`;
    actionId: `0x${string}`;
    payloadHash: `0x${string}`;
    deadline: bigint;
  }): Promise<`0x${string}`> {
    const publicClient = await viem.getPublicClient();
    const chainId = publicClient.chain!.id;

    // read current nonce from contract: nonces[caller]
    const [nonce] = await token.read.nonces([caller]);

    // EIP-712 domain for EIP712("BankMintToken-Endorsement","1") in constructor
    const domain = {
      name: "BankMintToken-Endorsement",
      version: "1",
      chainId,
      verifyingContract: token.address,
    } as const;

    // Types for the message
    const types = {
      Action: [
        { name: "caller",      type: "address" },
        { name: "actionId",    type: "bytes32" },
        { name: "payloadHash", type: "bytes32" },
        { name: "nonce",       type: "uint256" },
        { name: "deadline",    type: "uint256" },
      ],
    } as const;

    const message = {
      caller,
      actionId,
      payloadHash,
      nonce,
      deadline,
    } as const;

    // viem walletClient.signTypedData
    const sig = await endorser.signTypedData({
      domain,
      types,
      primaryType: "Action",
      message,
    });

    return sig;
  }

  //
  // payload hash helpers (must match solidity exactly)
  //

  function buildMintPayloadHash(to: `0x${string}`, amount: bigint): `0x${string}` {
    // keccak256(abi.encode(to, amount))
    const encoded = encodeAbiParameters(
      parseAbiParameters("address to, uint256 amount"),
      [to, amount]
    );
    return keccak256(encoded);
  }

  function buildAirdropPayloadHash(
    recipients: `0x${string}`[],
    amounts: bigint[]
  ): `0x${string}` {
    // Solidity does:
    // bytes32 toHash      = keccak256(abi.encodePacked(to));
    // bytes32 amountsHash = keccak256(abi.encodePacked(amounts));
    // bytes32 payloadHash = keccak256(abi.encode(toHash, amountsHash));

    const toHash = keccak256(
      // abi.encodePacked(address[]) is just concat of each address left-padded to 32?
      // BUT: abi.encodePacked(address[]) in Solidity actually packs each element as 20 bytes back-to-back.
      // viem's encodeAbiParameters always pads to 32. We need packed.
      // We'll manually pack.
      toBytes(
        recipients
          .map((addr) => addr.toLowerCase().replace(/^0x/, "")) // strip 0x
          .join("")
      )
    );

    // abi.encodePacked(uint256[]) is each uint256 in 32 bytes, concatenated.
    // That's equivalent to encodeAbiParameters with each element individually, join hex, then keccak256.
    // We'll build a packed hex ourselves.
    const packedAmountsHex = amounts
      .map((amt) => {
        // each uint256 should be 32-byte left-padded hex
        const h = toHex(amt).replace(/^0x/, "");
        return h.padStart(64, "0");
      })
      .join("");
    const amountsHash = keccak256(toBytes(packedAmountsHex));

    // payloadHash = keccak256(abi.encode(toHash, amountsHash));
    const payloadEncoded = encodeAbiParameters(
      parseAbiParameters("bytes32 toHash, bytes32 amountsHash"),
      [toHash, amountsHash]
    );
    return keccak256(payloadEncoded);
  }

  // ---------------------------------
  // TESTS
  // ---------------------------------

  it("deploys with correct name/symbol/cap and initial mint", async () => {
    const { token, deployer, initialMint, cap } = await deployFixture();

    const [name, symbol, totalSupply, capRead] = await Promise.all([
      token.read.name(),
      token.read.symbol(),
      token.read.totalSupply(),
      token.read.cap(),
    ]);

    expect(name).to.equal("CampusCreditV3");
    expect(symbol).to.equal("CCV3");
    expect(totalSupply).to.equal(initialMint);
    expect(capRead).to.equal(cap);

    const balDeployer = await token.read.balanceOf([await deployer.getAddress()]);
    expect(balDeployer).to.equal(initialMint);
  });

  it("grants deployer all admin roles", async () => {
    const { token, deployer, roles } = await deployFixture();
    const adminAddr = await deployer.getAddress();

    const isAdmin    = await token.read.hasRole([roles.DEFAULT_ADMIN_ROLE, adminAddr]);
    const isMinter   = await token.read.hasRole([roles.MINTER_ROLE, adminAddr]);
    const isPauser   = await token.read.hasRole([roles.PAUSER_ROLE, adminAddr]);
    const isEndorser = await token.read.hasRole([roles.ENDORSER_ROLE, adminAddr]);

    expect(isAdmin).to.be.true;
    expect(isMinter).to.be.true;
    expect(isPauser).to.be.true;
    expect(isEndorser).to.be.true;
  });

  it("only PAUSER_ROLE can pause/unpause, and pause actually blocks transfers", async () => {
    const { token, pauser, rando, deployer } = await deployFixture();

    const pauserAddr = await pauser.getAddress();
    const randoAddr  = await rando.getAddress();
    const deployerAddr = await deployer.getAddress();

    // rando cannot pause
    await expect(
      token.write.pause([], { account: rando.account })
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");

    // pauser can pause
    await token.write.pause([], { account: pauser.account });

    // during pause: transfer should revert
    await expect(
      token.write.transfer([randoAddr, 1n], { account: deployer.account })
    ).to.be.revertedWithCustomError(token, "EnforcedPause");

    // rando cannot unpause
    await expect(
      token.write.unpause([], { account: rando.account })
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");

    // pauser can unpause
    await token.write.unpause([], { account: pauser.account });

    // now transfer works again
    await token.write.transfer([randoAddr, 1n], { account: deployer.account });

    const balRando = await token.read.balanceOf([randoAddr]);
    expect(balRando).to.equal(1n);
  });

  it("only MINTER_ROLE can mint(), and cap is enforced", async () => {
    const { token, minter, rando, cap } = await deployFixture();

    const minterAddr = await minter.getAddress();
    const randoAddr  = await rando.getAddress();

    // rando cannot mint
    await expect(
      token.write.mint([randoAddr, 1n], { account: rando.account })
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");

    // minter can mint
    await token.write.mint([randoAddr, 123n], { account: minter.account });

    const bal = await token.read.balanceOf([randoAddr]);
    expect(bal).to.equal(123n);

    // try to blow past cap: mint huge amount beyond remaining supply => should revert from ERC20Capped
    const supplyNow = await token.read.totalSupply();
    const remaining = cap - supplyNow;
    // mint remaining is ok
    await token.write.mint([randoAddr, remaining], { account: minter.account });

    // next 1 wei should fail
    await expect(
      token.write.mint([randoAddr, 1n], { account: minter.account })
    ).to.be.revertedWith("ERC20Capped: cap exceeded"); // OZ revert string
  });

  it("airdrop() reverts on length mismatch and enforces cap", async () => {
    const { token, minter, rando, deployer, cap } = await deployFixture();

    const randoAddr    = await rando.getAddress();
    const deployerAddr = await deployer.getAddress();

    // length mismatch
    await expect(
      token.write.airdrop(
        [[randoAddr, deployerAddr], [1n]], // to[], amounts[] (bad lengths)
        { account: minter.account }
      )
    ).to.be.revertedWithCustomError(token, "ArrayLengthMismatch");

    // happy path airdrop inside cap
    await token.write.airdrop(
      [[randoAddr, deployerAddr], [10n, 20n]],
      { account: minter.account }
    );

    expect(await token.read.balanceOf([randoAddr])).to.be.gte(10n);
    expect(await token.read.balanceOf([deployerAddr])).to.be.gte(20n);

    // now try to exceed cap with a single huge airdrop
    const supplyNow = await token.read.totalSupply();
    const remaining = cap - supplyNow;

    // airdrop exactly remaining works
    await token.write.airdrop(
      [[randoAddr], [remaining]],
      { account: minter.account }
    );

    // exceeding cap by 1 should revert with CapExceeded()
    await expect(
      token.write.airdrop(
        [[randoAddr], [1n]],
        { account: minter.account }
      )
    ).to.be.revertedWithCustomError(token, "CapExceeded");
  });

  it("mintEndorsed() succeeds with valid endorsement from ENDORSER_ROLE", async () => {
    const { token, minter, endorser, rando } = await deployFixture();

    const minterAddr  = await minter.getAddress();
    const recipient   = await rando.getAddress();
    const amount      = 500n;
    const deadline    = BigInt(Math.floor(Date.now() / 1000) + 3600); // now+1h

    // Build payloadHash = keccak256(abi.encode(to, amount))
    const payloadHash = buildMintPayloadHash(recipient, amount);

    // Sign endorsement off-chain as ENDORSER_ROLE
    const sig = await signAction({
      token,
      endorser,
      caller: minterAddr,
      actionId: ACTION_MINT,
      payloadHash,
      deadline,
    });

    // Call mintEndorsed as MINTER_ROLE
    await token.write.mintEndorsed([recipient, amount, deadline, sig], {
      account: minter.account,
    });

    // balance updated
    const bal = await token.read.balanceOf([recipient]);
    expect(bal).to.equal(amount);
  });

  it("airdropEndorsed() mints batch with valid endorsement", async () => {
    const { token, minter, endorser, rando, deployer } = await deployFixture();

    const minterAddr   = await minter.getAddress();
    const randoAddr    = await rando.getAddress();
    const deployerAddr = await deployer.getAddress();

    const tos = [randoAddr, deployerAddr] as const;
    const amts = [111n, 222n];

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Build payloadHash exactly like contract:
    const payloadHash = buildAirdropPayloadHash(tos.slice() as any, amts.slice());

    const sig = await signAction({
      token,
      endorser,
      caller: minterAddr,
      actionId: ACTION_AIRDROP,
      payloadHash,
      deadline,
    });

    await token.write.airdropEndorsed([tos, amts, deadline, sig], {
      account: minter.account,
    });

    const balRando    = await token.read.balanceOf([randoAddr]);
    const balDeployer = await token.read.balanceOf([deployerAddr]);
    expect(balRando).to.equal(111n);
    expect(balDeployer).to.equal(222n);
  });

  it("mintEndorsed() reverts if endorsement is expired", async () => {
    const { token, minter, endorser, rando } = await deployFixture();

    const minterAddr = await minter.getAddress();
    const recipient  = await rando.getAddress();
    const amount     = 10n;
    const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 10); // already expired

    const payloadHash = buildMintPayloadHash(recipient, amount);

    const sig = await signAction({
      token,
      endorser,
      caller: minterAddr,
      actionId: ACTION_MINT,
      payloadHash,
      deadline: pastDeadline,
    });

    await expect(
      token.write.mintEndorsed([recipient, amount, pastDeadline, sig], {
        account: minter.account,
      })
    ).to.be.revertedWithCustomError(token, "EndorsementExpired");
  });

  it("mintEndorsed() reverts if signer is NOT an ENDORSER_ROLE address", async () => {
    const { token, minter, rando } = await deployFixture();

    // Note: rando does NOT have ENDORSER_ROLE
    const minterAddr = await minter.getAddress();
    const recipient  = await rando.getAddress();
    const amount     = 10n;
    const deadline   = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const payloadHash = buildMintPayloadHash(recipient, amount);

    // Sign with the WRONG signer (rando, not endorser)
    const sig = await signAction({
      token,
      endorser: rando, // <--- wrong signer
      caller: minterAddr,
      actionId: ACTION_MINT,
      payloadHash,
      deadline,
    });

    // Should revert EndorsementBadSigner()
    await expect(
      token.write.mintEndorsed([recipient, amount, deadline, sig], {
        account: minter.account,
      })
    ).to.be.revertedWithCustomError(token, "EndorsementBadSigner");
  });

  it("consumes nonce per caller so you cannot replay the same signature twice", async () => {
    const { token, minter, endorser, rando } = await deployFixture();

    const minterAddr = await minter.getAddress();
    const recipient  = await rando.getAddress();
    const amount     = 9n;
    const deadline   = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const payloadHash = buildMintPayloadHash(recipient, amount);

    // sign endorsement for nonce 0
    const sig = await signAction({
      token,
      endorser,
      caller: minterAddr,
      actionId: ACTION_MINT,
      payloadHash,
      deadline,
    });

    // first call works
    await token.write.mintEndorsed([recipient, amount, deadline, sig], {
      account: minter.account,
    });

    // second call with SAME sig should now fail (nonce already incremented on first use)
    await expect(
      token.write.mintEndorsed([recipient, amount, deadline, sig], {
        account: minter.account,
      })
    ).to.be.revertedWithCustomError(token, "EndorsementBadSigner");
    // note: it'll fail because the recovered signer is fine,
    // BUT the struct hashed in _requireEndorsement (with nonce=1) won't match the signed data (nonce=0),
    // so recover() returns some arbitrary address that won't have ENDORSER_ROLE, triggering EndorsementBadSigner().
  });
});
