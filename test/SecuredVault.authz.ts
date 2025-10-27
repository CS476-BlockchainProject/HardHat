import { expect } from "chai";
import { ethers } from "hardhat";

describe("SecuredVault AuthZ", () => {
  it("blocks withdraw without endorsement", async () => {
    const [admin, user] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("SecuredVault");
    const vault = await Vault.deploy(admin.address);
    await vault.waitForDeployment();

    await vault.connect(user).deposit({ value: ethers.parseEther("1") });
    await expect(
      vault.connect(user).withdraw(ethers.parseEther("0.1"), Math.floor(Date.now()/1000)+600, "0x")
    ).to.be.reverted; // lacks valid endorsement
  });
});
