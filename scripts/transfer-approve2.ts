#!/usr/bin/env ts-node
import { Address, getContract, zeroAddress } from 'viem';
import { loadArtifact, makeClients, requireEnv, parseUnits18, fees } from './_utils';

(async () => {
  try {
    const { publicClient, walletClient } = makeClients();
    const { abi } = loadArtifact();

    const token = requireEnv('TOKEN_ADDRESS') as Address;
    const second = requireEnv('SECOND_ADDRESS') as Address;
    const transferAmt = parseUnits18(requireEnv('TRANSFER_AMOUNT'));
    const approveAmt = parseUnits18(requireEnv('APPROVE_AMOUNT'));

    const [deployer] = await walletClient.getAddresses();
    const c = getContract({ address: token, abi, client: { public: publicClient, wallet: walletClient } });

    const bal = async (addr: Address) => await c.read.balanceOf([addr]);
    const beforeA = await bal(deployer as Address);
    const beforeB = await bal(second);

    console.log('Balances BEFORE:');
    console.log(`  ${deployer}: ${beforeA} wei`);
    console.log(`  ${second}: ${beforeB} wei`);

    const { maxFeePerGas, maxPriorityFeePerGas } = fees();

    // transfer
    const tx1 = await c.write.transfer([second, transferAmt], { maxFeePerGas, maxPriorityFeePerGas });
    const r1 = await publicClient.waitForTransactionReceipt({ hash: tx1 });
    const paid1 = r1.gasUsed * (r1.effectiveGasPrice ?? 0n);
    console.log('\nTransfer:');
    console.log('  tx hash:', tx1);
    console.log('  block  :', r1.blockNumber.toString());
    console.log('  gasUsed:', r1.gasUsed.toString(), ' paid:', paid1.toString(), 'wei');

    // approve
    const tx2 = await c.write.approve([second, approveAmt], { maxFeePerGas, maxPriorityFeePerGas });
    const r2 = await publicClient.waitForTransactionReceipt({ hash: tx2 });
    const paid2 = r2.gasUsed * (r2.effectiveGasPrice ?? 0n);
    console.log('\nApprove:');
    console.log('  tx hash:', tx2);
    console.log('  block  :', r2.blockNumber.toString());
    console.log('  gasUsed:', r2.gasUsed.toString(), ' paid:', paid2.toString(), 'wei');

    const allowance = await c.read.allowance([deployer as Address, second]);
    const afterA = await bal(deployer as Address);
    const afterB = await bal(second);

    console.log('\nBalances AFTER:');
    console.log(`  ${deployer}: ${afterA} wei`);
    console.log(`  ${second}: ${afterB} wei`);
    console.log('\nAllowance:');
    console.log(`  owner=${deployer} spender=${second} allowance=${allowance} wei`);

    if (afterA === undefined || allowance === undefined) process.exit(1);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
