// hardhat.config.ts
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import { HardhatUserConfig } from "hardhat/config";

const RPC_URL = process.env.RPC_URL || "";            // set in GitHub Secrets/Variables
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";    // set in GitHub Secrets
const CHAIN_ID = process.env.CHAIN_ID
  ? Number(process.env.CHAIN_ID)
  : undefined;

// Default to local in-memory network for builds/tests
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {},

    // Used only by the deploy step in CI
    didlab: {
      url: RPC_URL,                       // must be set by env/secret in CI
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : undefined,
      chainId: CHAIN_ID,                
    },
  },
};

export default config;
