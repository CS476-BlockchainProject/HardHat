// hardhat.config.ts
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import { HardhatUserConfig } from "hardhat/config";

const networks: HardhatUserConfig["networks"] = {
  hardhat: { type: "edr-simulated" },
};

// Only include the didlab network if CI/local env provides RPC_URL
if (process.env.RPC_URL) {
  networks!.didlab = {
    type: "http",
    url: process.env.RPC_URL!,                        
    accounts: process.env.PRIVATE_KEY
      ? [process.env.PRIVATE_KEY]                      
      : undefined,                                    
    chainId: process.env.CHAIN_ID
      ? Number(process.env.CHAIN_ID)
      : undefined,
  };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  defaultNetwork: "hardhat",
  networks,
};

export default config;
