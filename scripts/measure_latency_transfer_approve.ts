#!/usr/bin/env ts-node
import type { Address } from "viem";
import fs from "node:fs";
import path from "node:path";
import { getContract } from "viem";
import { loadArtifact, makeClients, requireEnv, parseUnits18, fees } from "./_utils";

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

(async () => {
  try {
    const { publicClient, walletClient } = makeClients();
    const { abi } = await loadArtifact("BankMintToken"); // or CampusCreditV3

    const token = requireEnv("TOKEN_ADDRESS") as Address;
    const second = requireEnv("SECOND_ADDRESS") as Address;
    const transferAmt = parseUnits18(requireEnv("TRANSFER_AMOUNT"));
    const approveAmt = parseUnits18(requireEnv("APPROVE_AMOUNT"));
    const N = Number(process.env.METRIC_CALLS || 20);
    const outPath = "metrics/transfer_approve_latency.csv";

    const [deployer] = await walletClient.getAddresses();
    const { maxFeePerGas, maxPriorityFeePerGas } = fees();

    const c = getContract({
      address: token,
      abi,
      client: walletClient,
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const rows: {
      i: number;
      op: string;
      ms: number;
      gasUsed: bigint;
      block: bigint;
    }[] = [];

    console.log(`Measuring latency for ${N} transfer+approve cycles...\n`);

    for (let i = 0; i < N; i++) {
      // TRANSFER
      const t0 = nowMs();
      const tx1 = await c.write.transfer([second, transferAmt], { maxFeePerGas, maxPriorityFeePerGas });
      const r1 = await publicClient.waitForTransactionReceipt({ hash: tx1 });
      const t1 = nowMs();
      rows.push({ i, op: "transfer", ms: t1 - t0, gasUsed: r1.gasUsed, block: BigInt(r1.blockNumber!) });

      // APPROVE
      const t2 = nowMs();
      const tx2 = await c.write.approve([second, approveAmt], { maxFeePerGas, maxPriorityFeePerGas });
      const r2 = await publicClient.waitForTransactionReceipt({ hash: tx2 });
      const t3 = nowMs();
      rows.push({ i, op: "approve", ms: t3 - t2, gasUsed: r2.gasUsed, block: BigInt(r2.blockNumber!) });

      await new Promise(r => setTimeout(r, 30)); // small pause to stabilize output
    }

    // Write CSV
    const header = "index,op,ms,gasUsed,block\n";
    const csv = header + rows.map(r => `${r.i},${r.op},${r.ms},${r.gasUsed},${r.block}`).join("\n");
    fs.writeFileSync(outPath, csv);

    // Summaries
    const transfers = rows.filter(r => r.op === "transfer").map(r => r.ms);
    const approves = rows.filter(r => r.op === "approve").map(r => r.ms);

    const summarize = (arr: number[]) => {
      const sorted = arr.slice().sort((a, b) => a - b);
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const p50 = sorted[Math.floor(0.5 * (sorted.length - 1))];
      const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
      return { mean, p50, p95 };
    };

    const s1 = summarize(transfers);
    const s2 = summarize(approves);

    console.log("\nLatency Summary (ms):");
    console.table([
      { op: "transfer", mean: s1.mean.toFixed(2), p50: s1.p50.toFixed(2), p95: s1.p95.toFixed(2) },
      { op: "approve",  mean: s2.mean.toFixed(2), p50: s2.p50.toFixed(2), p95: s2.p95.toFixed(2) },
    ]);

    // CI sanity check (median must be <1500ms)
    if (s1.p50 > 1500 || s2.p50 > 1500) {
      console.error("⚠️ Median latency exceeded threshold");
      process.exit(1);
    }

    console.log(`\nWrote results to ${outPath}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
