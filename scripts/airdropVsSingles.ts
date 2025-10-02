#!/usr/bin/env ts-node
import { Address, getContract } from 'viem';
import { loadArtifact, makeClients, requireEnv, parseUnits18, fees } from './_utils';

function parseCsv<T>(csv: string, map: (s: string) => T): T[] {
  return csv.split(',').map(s => map(s.trim()));
}

(async () => {
  try {
    const { publicClient, walletClient } = makeClients();
    const { abi } = loadArtifact();

    const token = requireEnv('TOKEN_ADDRESS') as Address;
    const toCsv = requireEnv('AIRDROP_TO');
    const amtCsv = requireEnv('AIRDROP_AMOUNTS');

    const recipients = parseCsv<Address>(toCsv, s => s as Address);
    const amountsHuman = parseCsv<string>(amtCsv, s => s);
    if (recipients.length !== amountsHuman.length) {
      console.error('AIRDROP_TO and AIRDROP_AMOUNTS length mismatch');
      process.exit(1);
    }
    const amounts = amountsHuman.map(parseUnits18);

    const c = getContract({ address: token, abi, client: { public: publicClient, wallet: walletClient } });
    const { maxFeePerGas, maxPriorityFeePerGas } = fees();

    // Batch airdrop
    const txBatch = await c.write.airdrop([recipients, amounts], { maxFeePerGas, maxPriorityFeePerGas });
    const rb = await publicClient.waitForTransactionReceipt({ hash: txBatch });
    const paidBatch = rb.gasUsed * (rb.effectiveGasPrice ?? 0n);

    // N singles (same total distribution) – do simple transfers
    let gasSingles = 0n;
    let weiSingles = 0n;
    for (let i = 0; i < recipients.length; i++) {
      const tx = await c.write.transfer([recipients[i], amounts[i]], { maxFeePerGas, maxPriorityFeePerGas });
      const r = await publicClient.waitForTransactionReceipt({ hash: tx });
      gasSingles += r.gasUsed;
      weiSingles += r.gasUsed * (r.effectiveGasPrice ?? 0n);
    }

    console.log('--- Gas Comparison ---');
    console.log('Recipients:', recipients.length);
    console.log('Batch:');
    console.log('  tx hash:', txBatch);
    console.log('  block  :', rb.blockNumber.toString());
    console.log('  gasUsed:', rb.gasUsed.toString(), ' paid:', paidBatch.toString(), 'wei');
    console.log('Singles (sum):');
    console.log('  gasUsed:', gasSingles.toString(), ' paid:', weiSingles.toString(), 'wei');

    const savedGas = rb.gasUsed === 0n ? 0 : ((gasSingles - rb.gasUsed) * 10000n) / gasSingles; // basis points
    const pct = Number(savedGas) / 100; // %
    console.log(`% gas saved vs singles: ${pct.toFixed(2)}%`);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
