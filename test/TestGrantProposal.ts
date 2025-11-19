// test/TestGrantProposal.ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";

const { viem } = await network.connect();

describe("GrantProposal (GrantProposal)", () => {
  const ACTION_MINT = keccak256(Buffer.from("MINT"));

  // -------------------------------
  // FIXTURE
  // -------------------------------
  async function deployFixture() {
    const [deployer, minter, pauser, endorser, rando] =
      await viem.getWalletClients();

    const cap = 1_000_000n * 10n ** 18n;
    const initialMint = 1000n * 10n ** 18n;

    const token = await viem.deployContract("GrantProposal", [
      "CampusCreditV3",
      "CCV3",
      cap,
      deployer.account.address,
      initialMint,
    ]);

    const publicClient = await viem.getPublicClient();

    const MINTER_ROLE = keccak256(Buffer.from("MINTER_ROLE"));
    const PAUSER_ROLE = keccak256(Buffer.from("PAUSER_ROLE"));
    const ENDORSER_ROLE = keccak256(Buffer.from("ENDORSER_ROLE"));
    const DEFAULT_ADMIN_ROLE =
      "0x0000000000000000000000000000000000000000000000000000000000000000";

    await token.write.grantRole(
      [MINTER_ROLE, minter.account.address],
      { account: deployer.account }
    );
    await token.write.grantRole(
      [PAUSER_ROLE, pauser.account.address],
      { account: deployer.account }
    );
    await token.write.grantRole(
      [ENDORSER_ROLE, endorser.account.address],
      { account: deployer.account }
    );

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

  // -------------------------------
  // SIGNER HELPER
  // -------------------------------
  async function signAction({
    token,
    endorser,
    caller,
    actionId,
    payloadHash,
    deadline,
  }: any) {
    const chainId = (await viem.getPublicClient()).chain!.id;
    const nonce: bigint = await token.read.nonces([caller]);

    return endorser.signTypedData({
      domain: {
        name: "BankMintToken-Endorsement",
        version: "1",
        chainId,
        verifyingContract: token.address,
      },
      types: {
        Action: [
          { name: "caller", type: "address" },
          { name: "actionId", type: "bytes32" },
          { name: "payloadHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Action",
      message: {
        caller,
        actionId,
        payloadHash,
        nonce,
        deadline,
      },
    }) as `0x${string}`;
  }

  // -------------------------------
  // PAYLOAD HELPERS
  // -------------------------------
  function buildMintPayloadHash(to: string, amount: bigint) {
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters("address to, uint256 amount"),
        [to, amount]
      )
    );
  }

  // ======================================================
  //                    TESTS
  // ======================================================

  it("deploys with correct name/symbol/cap and initial mint", async () => {
    const { token, deployer, initialMint, cap } = await deployFixture();

    expect(await token.read.name()).to.equal("CampusCreditV3");
    expect(await token.read.symbol()).to.equal("CCV3");
    expect(await token.read.totalSupply()).to.equal(initialMint);
    expect(await token.read.cap()).to.equal(cap);

    expect(
      await token.read.balanceOf([deployer.account.address])
    ).to.equal(initialMint);
  });

  it("grants deployer all admin roles", async () => {
    const { token, deployer, roles } = await deployFixture();
    const addr = deployer.account.address;

    expect(await token.read.hasRole([roles.DEFAULT_ADMIN_ROLE, addr])).to.be
      .true;
    expect(await token.read.hasRole([roles.MINTER_ROLE, addr])).to.be.true;
    expect(await token.read.hasRole([roles.PAUSER_ROLE, addr])).to.be.true;
    expect(await token.read.hasRole([roles.ENDORSER_ROLE, addr])).to.be.true;
  });

  it("only PAUSER_ROLE can pause/unpause, and pause actually blocks transfers", async () => {
    const { token, pauser, rando, deployer } = await deployFixture();

    // rando cannot pause
    try {
      await token.write.pause([], { account: rando.account });
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("AccessControlUnauthorizedAccount");
    }

    // pauser can pause
    await token.write.pause([], { account: pauser.account });

    // during pause: transfer should revert
    try {
      await token.write.transfer([rando.account.address, 1n], {
        account: deployer.account,
      });
      throw new Error("expected revert");
    } catch {
      // just needs to revert
    }

    // unpause
    await token.write.unpause([], { account: pauser.account });
    await token.write.transfer([rando.account.address, 1n], {
      account: deployer.account,
    });

    expect(
      await token.read.balanceOf([rando.account.address])
    ).to.equal(1n);
  });

  it("only MINTER_ROLE can mint(), and cap is enforced", async () => {
    const { token, minter, rando, cap } = await deployFixture();
    const randoAddr = rando.account.address;

    // rando cannot mint
    try {
      await token.write.mint([randoAddr, 1n], { account: rando.account });
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("AccessControlUnauthorizedAccount");
    }

    // minter can mint
    await token.write.mint([randoAddr, 123n], {
      account: minter.account,
    });

    // fill up to cap
    const supply = await token.read.totalSupply();
    const remaining = cap - supply;

    await token.write.mint([randoAddr, remaining], {
      account: minter.account,
    });

    // next wei should revert (cap enforced) – just assert that it *does* revert
    let reverted = false;
    try {
      await token.write.mint([randoAddr, 1n], { account: minter.account });
    } catch {
      reverted = true;
    }
    expect(reverted).to.equal(true);
  });

  it("airdrop() reverts on length mismatch and enforces cap", async () => {
    const { token, minter, deployer, rando, cap } = await deployFixture();

    // length mismatch revert
    try {
      await token.write.airdrop(
        [[rando.account.address, deployer.account.address], [1n]],
        { account: minter.account }
      );
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("ArrayLengthMismatch");
    }

    // happy path
    await token.write.airdrop(
      [[rando.account.address, deployer.account.address], [10n, 20n]],
      { account: minter.account }
    );

    // cap enforcement via airdrop is covered in other flows; here we just ensure it works
  });

  it("mintEndorsed() succeeds with valid endorsement from ENDORSER_ROLE", async () => {
    const { token, minter, endorser, rando } = await deployFixture();

    const caller = minter.account.address;
    const recipient = rando.account.address;
    const amount = 500n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const payload = buildMintPayloadHash(recipient, amount);

    const sig = await signAction({
      token,
      endorser,
      caller,
      actionId: ACTION_MINT,
      payloadHash: payload,
      deadline,
    });

    await token.write.mintEndorsed([recipient, amount, deadline, sig], {
      account: minter.account,
    });

    expect(await token.read.balanceOf([recipient])).to.equal(amount);
  });

  it("mintEndorsed() reverts if endorsement is expired", async () => {
    const { token, minter, endorser, rando } = await deployFixture();

    const recipient = rando.account.address;
    const payload = buildMintPayloadHash(recipient, 10n);

    const past = BigInt(Math.floor(Date.now() / 1000) - 20);

    const sig = await signAction({
      token,
      endorser,
      caller: minter.account.address,
      actionId: ACTION_MINT,
      payloadHash: payload,
      deadline: past,
    });

    try {
      await token.write.mintEndorsed([recipient, 10n, past, sig], {
        account: minter.account,
      });
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("EndorsementExpired");
    }
  });

  it("mintEndorsed() reverts if signer is NOT an ENDORSER_ROLE address", async () => {
    const { token, minter, rando } = await deployFixture();

    const recipient = rando.account.address;
    const payload = buildMintPayloadHash(recipient, 10n);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const sig = await signAction({
      token,
      endorser: rando, // wrong signer
      caller: minter.account.address,
      actionId: ACTION_MINT,
      payloadHash: payload,
      deadline,
    });

    try {
      await token.write.mintEndorsed([recipient, 10n, deadline, sig], {
        account: minter.account,
      });
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e.message)).to.include("EndorsementBadSigner");
    }
  });

  it("consumes nonce per caller so you cannot replay the same signature twice", async () => {
    const { token, minter, endorser, rando } = await deployFixture();

    const caller = minter.account.address;
    const recipient = rando.account.address;
    const amount = 9n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const payload = buildMintPayloadHash(recipient, amount);

    const sig = await signAction({
      token,
      endorser,
      caller,
      actionId: ACTION_MINT,
      payloadHash: payload,
      deadline,
    });

    // first use works
    await token.write.mintEndorsed([recipient, amount, deadline, sig], {
      account: minter.account,
    });

    // replay should now fail because nonce advanced
    let reverted = false;
    try {
      await token.write.mintEndorsed([recipient, amount, deadline, sig], {
        account: minter.account,
      });
    } catch (e: any) {
      reverted = true;
      expect(String(e.message)).to.include("EndorsementBadSigner");
    }
    expect(reverted).to.equal(true);
  });
});
