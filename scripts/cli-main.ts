/**
 * Minimal menu CLI for:
 * - scripts/deploy2.ts
 * - scripts/transfer-approve2.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { spawn } from "node:child_process";
import readline from "node:readline";
import { promisify } from "node:util";
import { resolve } from "node:path";

// ------- helpers -------
export function runHardhatScript(scriptRelPath: string, extraEnv: Record<string, string> = {}) {
  return new Promise<void>((resolvePromise, reject) => {
    const scriptPath = resolve(process.cwd(), scriptRelPath);
    const child = spawn(
      "npx",
      ["hardhat", "run", scriptPath, "--network", process.env.NETWORK?.trim() || "hardhat"],
      {
        shell: true,
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));

    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Hardhat run exited with code ${code}`));
    });
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = promisify(rl.question).bind(rl) as (q: string) => Promise<string>;

function banner() {
  console.log("\n========================================================");
  console.log("  Hardhat Minimal Client — Deploy & Transfer CLI");
  console.log("========================================================");
  console.log("Network :", process.env.NETWORK?.trim() || "hardhat");
  console.log("RPC_URL :", process.env.RPC_URL || "(unset)");
  console.log("CHAIN_ID:", process.env.CHAIN_ID || "(unset)");
  console.log("TOKEN   :", process.env.TOKEN_ADDRESS || "(unset — will be set after deploy)");
  console.log("========================================================\n");
}

async function doDeploy() {
  console.log("\n[1] Running deploy2.ts …\n");
  await runHardhatScript("scripts/deploy2.ts");
  console.log("\n✅ Deploy finished. If your utils write TOKEN_ADDRESS, it’s now in .env.\n");
}

async function doTransfer() {
  console.log("\n[2] Attempt a transfer (reads TOKEN_ADDRESS from .env)…\n");
  const to = (await question("Recipient TO address (leave blank to use .env TO): ")).trim();
  const amt = (await question("Amount (leave blank to use .env TRANSFER_AMOUNT): ")).trim();
  const extraEnv: Record<string, string> = { ACTION: "transfer" };
  if (to) extraEnv["TO"] = to;
  if (amt) extraEnv["TRANSFER_AMOUNT"] = amt;

  console.log("\nRunning transfer-approve2.ts with ACTION=transfer …\n");
  await runHardhatScript("scripts/transfer-approve2.ts", extraEnv);
  console.log("\n✅ Transfer finished. See above for tx hash, block, before/after, and event proof.\n");
}

async function doTransferApprove() {
  console.log("\n[3] Run transfer-approve2.ts using ACTION in .env …\n");
  const action = (await question('ACTION to run [transfer/approve] (leave blank to use .env ACTION): ')).trim().toLowerCase();
  const extraEnv: Record<string, string> = {};
  if (action === "transfer" || action === "approve") extraEnv["ACTION"] = action;

  if (action === "transfer") {
    const to = (await question("TO (leave blank to use .env TO): ")).trim();
    const amt = (await question("TRANSFER_AMOUNT (leave blank to use .env TRANSFER_AMOUNT): ")).trim();
    if (to) extraEnv["TO"] = to;
    if (amt) extraEnv["TRANSFER_AMOUNT"] = amt;
  } else if (action === "approve") {
    const spender = (await question("SPENDER (leave blank to use .env SPENDER): ")).trim();
    const aamt = (await question("APPROVE_AMOUNT (leave blank to use .env APPROVE_AMOUNT): ")).trim();
    if (spender) extraEnv["SPENDER"] = spender;
    if (aamt) extraEnv["APPROVE_AMOUNT"] = aamt;
  }

  console.log("\nRunning transfer-approve2.ts …\n");
  await runHardhatScript("scripts/transfer-approve2.ts", extraEnv);
  console.log("\n✅ Finished. See above for hashes, blocks, and decoded events.\n");
}

async function doFullDemo() {
  console.log("\n[4] Full demo: Deploy → Transfer (proofs)\n");
  await doDeploy();
  const to = (await question("Recipient TO (leave blank to use .env TO): ")).trim();
  const amt = (await question("Transfer amount (default 25 if blank and .env missing): ")).trim();
  const extraEnv: Record<string, string> = { ACTION: "transfer" };
  if (to) extraEnv["TO"] = to;
  if (amt) extraEnv["TRANSFER_AMOUNT"] = amt || "25";

  await runHardhatScript("scripts/transfer-approve2.ts", extraEnv);
  console.log("\n✅ Demo complete. Proof is shown above (before/after and event logs).\n");
}

export async function main() {
  banner();
  while (true) {
    console.log("Choose an action:");
    console.log("  [1] Run deploy2.ts");
    console.log("  [2] Attempt a Transfer (ACTION=transfer)");
    console.log("  [3] Run transfer-approve2.ts (transfer or approve)");
    console.log("  [4] Full Demo (Deploy → Transfer)");
    console.log("  [q] Quit\n");

    const ans = (await question("Your choice: ")).trim().toLowerCase();
    try {
      if (ans === "1") await doDeploy();
      else if (ans === "2") await doTransfer();
      else if (ans === "3") await doTransferApprove();
      else if (ans === "4") await doFullDemo();
      else if (ans === "q") break;
      else console.log("Unknown choice.\n");
    } catch (e: any) {
      console.error(`\n❌ Error: ${e?.message || e}\n`);
    }
  }
  rl.close();
}

export default main;
