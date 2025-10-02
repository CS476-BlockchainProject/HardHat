import "dotenv/config";
import { artifacts } from "hardhat";
import { createPublicClient, http, decodeEventLog } from "viem";

const RPC_URL = process.env.RPC_URL!;
const CHAIN_ID = Number(process.env.CHAIN_ID!);
const TOKEN = process.env.TOKEN_ADDRESS as `0x${string}`;

async function main() {
  if (!RPC_URL || !CHAIN_ID || !TOKEN) throw new Error("Missing env");

  const { abi } = await artifacts.readArtifact("CampusCreditV2");
  const chain = { id: CHAIN_ID, name:`didlab-${CHAIN_ID}`, nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18}, rpcUrls:{default:{http:[RPC_URL]}} } as const;
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 2000n ? latest - 2000n : 0n;

  const logs = await publicClient.getLogs({ address: TOKEN, fromBlock, toBlock: "latest" });

  for (const log of logs) {
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      console.log(`[${log.blockNumber}] ${ev.eventName}`, ev.args);
    } catch {
      /* non-erc20 events (if any) */
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });