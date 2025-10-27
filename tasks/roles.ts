import { task } from "hardhat/config";
import { ethers } from "hardhat";

task("role:grant", "Grant a role to an address")
  .addParam("contract", "Deployed contract address")
  .addParam("role", "Role name: DEFAULT_ADMIN_ROLE | PAUSER_ROLE | OPERATOR_ROLE | ENDORSER_ROLE")
  .addParam("to", "Beneficiary address")
  .setAction(async ({ contract, role, to }, hre) => {
    const [signer] = await hre.ethers.getSigners();
    const abi = [
      "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
      "function PAUSER_ROLE() view returns (bytes32)",
      "function OPERATOR_ROLE() view returns (bytes32)",
      "function ENDORSER_ROLE() view returns (bytes32)",
      "function grantRole(bytes32 role,address account) external",
    ];
    const c = await ethers.getContractAt(abi, contract, signer);
    const roleHash = await c[role]();
    const tx = await c.grantRole(roleHash, to);
    console.log(`grantRole(${role}, ${to}) → ${tx.hash}`);
    await tx.wait();
    console.log("done.");
  });
