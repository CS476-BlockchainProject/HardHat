import { ethers } from "hardhat";
import { keccak256, toUtf8Bytes } from "ethers";

async function main() {
  const [gateway] = await ethers.getSigners(); // the ENDORSER_ROLE signer
  const caller   = "0xCallerAddress";
  const actionId = keccak256(toUtf8Bytes("WITHDRAW")); // must match contract constant
  const value    = ethers.parseEther("0.1");
  const deadline = Math.floor(Date.now()/1000) + 600;

  const domain = {
    name: "MyProject-Endorsement",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: "0xYourVaultAddress",
  };

  const types = {
    Action: [
      { name: "caller",   type: "address" },
      { name: "actionId", type: "bytes32" },
      { name: "value",    type: "uint256" },
      { name: "nonce",    type: "uint256" },   // read from contract if you want exact
      { name: "deadline", type: "uint256" },
    ],
  };

  // If you want exact nonce, call: const nonce = await vault.nonces(caller)
  const nonce = 0n;
  const valueToSign = { caller, actionId, value, nonce, deadline };

  const sig = await gateway.signTypedData(domain, types, valueToSign);
  console.log("signature:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });