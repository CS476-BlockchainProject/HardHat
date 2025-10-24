import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import { HardhatUserConfig } from "hardhat/config";

const networks: HardhatUserConfig["networks"] = {
  hardhat: {
    // Use this if you want to simulate EVM locally
    type: "edr-simulated",
  },
};

// Add didlab network only if RPC_URL is provided in env
if (process.env.RPC_URL) {
  networks.didlab = {
    type: "http",
    url: process.env.RPC_URL,
    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : undefined,
    chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined,
    gasPrice:2000000000,
  };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.21",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris", // to avoid PUSH0 opcode errors
    },
  },
  networks,
};

export default config;