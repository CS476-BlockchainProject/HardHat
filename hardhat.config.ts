// hardhat.config.ts
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const RPC_URL = process.env.RPC_URL || "";
const CHAIN_ID = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

export default {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    didlab: {
      url: RPC_URL,
      chainId: CHAIN_ID,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : undefined,
      type: "http",
    },
  },
  defaultNetwork: "didlab", 
};
