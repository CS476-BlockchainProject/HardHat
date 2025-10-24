#!/usr/bin/env ts-node
import fs from 'fs';
import { Address, parseGwei } from 'viem';
import {
  makeClients, parseUnits18, fees, requireEnv, maybeEnv, updateEnvTokenAddress
} from './_utils';

type Eip1559 = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
type Legacy  = { gasPrice: bigint };

function readArtifact(path: string) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

(async () => {
  try {
    const { publicClient, walletClient } = makeClients();
    const [deployer] = await walletClient.getAddresses();

    // keep ALL your .env usage
    const name = requireEnv('TOKEN_NAME');
    const symbol = requireEnv('TOKEN_SYMBOL');
    const capHuman = requireEnv('TOKEN_CAP');
    const initialMintHuman = requireEnv('INITIAL_MINT');
    const cap = parseUnits18(capHuman);
    const initialMint = parseUnits18(initialMintHuman);
    const defaultReceiver = deployer as Address;
    const initialReceiver = (maybeEnv('INITIAL_RECEIVER') as Address) || defaultReceiver;
    const aprBps = Number(process.env.APR_BPS ?? 500);

    // fee picker (1559 if supported, else legacy)
    async function pickFees(): Promise<Eip1559 | Legacy> {
      if (process.env.GAS_PRICE_GWEI) return { gasPrice: parseGwei(process.env.GAS_PRICE_GWEI) };
      try {
        const s = await publicClient.estimateFeesPerGas();
        return {
          maxFeePerGas: process.env.MAX_FEE_GWEI ? parseGwei(process.env.MAX_FEE_GWEI) : s.maxFeePerGas!,
          maxPriorityFeePerGas: process.env.MAX_PRIORITY_FEE_GWEI
            ? parseGwei(process.env.MAX_PRIORITY_FEE_GWEI)
            : s.maxPriorityFeePerGas!,
        };
      } catch {
        return { gasPrice: process.env.GAS_PRICE_GWEI
          ? parseGwei(process.env.GAS_PRICE_GWEI)
          : await publicClient.getGasPrice() };
      }
    }
    const feeParams = await pickFees();
    const is1559 = 'maxFeePerGas' in feeParams;
    const toGwei = (wei: bigint) => (Number(wei) / 1e9).toFixed(2);

    console.log('====================================================');
    console.log('Deploying contracts with the following parameters:');
    console.log(`Deployer:           ${deployer}`);
    console.log(`TOKEN_NAME:         ${name}`);
    console.log(`TOKEN_SYMBOL:       ${symbol}`);
    console.log(`TOKEN_CAP:          ${capHuman}`);
    console.log(`INITIAL_MINT:       ${initialMintHuman}`);
    console.log(`INITIAL_RECEIVER:   ${initialReceiver}`);
    console.log(`APR_BPS:            ${aprBps}`);
    if (is1559) {
      console.log(`MaxFeePerGas:       ${toGwei((feeParams as Eip1559).maxFeePerGas)} gwei`);
      console.log(`PriorityFeePerGas:  ${toGwei((feeParams as Eip1559).maxPriorityFeePerGas)} gwei`);
    } else {
      console.log(`GasPrice:           ${toGwei((feeParams as Legacy).gasPrice)} gwei`);
    }
    console.log('====================================================');

    // --- read exact artifacts by path (no ambiguity) ---
    const nftArtifact = readArtifact('artifacts/contracts/ReceiptNFT.sol/ReceiptNFT.json');
    const poolArtifact = readArtifact('artifacts/contracts/SavingsPool.sol/SavingsPool.json');

    // --- 1) Deploy ReceiptNFT (no args) ---
    console.log('Deploying ReceiptNFT...');
    const nftHash = await walletClient.deployContract({
      abi: nftArtifact.abi,
      bytecode: nftArtifact.bytecode,
      ...(feeParams as any),
      // gas: BigInt(3_000_000), // uncomment if estimator is flaky
    });
    const nftReceipt = await publicClient.waitForTransactionReceipt({ hash: nftHash });
    const nftAddress = nftReceipt.contractAddress as Address;
    if (!nftAddress) throw new Error('No contractAddress for ReceiptNFT');
    console.log(`✅ ReceiptNFT deployed at: ${nftAddress}`);
    console.log(`   tx hash: ${nftHash}`);

    // --- 2) Deploy SavingsPool(aprBps, nftAddress) ---
    console.log('Deploying SavingsPool...');
    const poolHash = await walletClient.deployContract({
      abi: poolArtifact.abi,
      bytecode: poolArtifact.bytecode,
      args: [aprBps, nftAddress],
      ...(feeParams as any),
      // gas: BigInt(4_500_000),
    });
    const poolReceipt = await publicClient.waitForTransactionReceipt({ hash: poolHash });
    const poolAddress = poolReceipt.contractAddress as Address;
    if (!poolAddress) throw new Error('No contractAddress for SavingsPool');
    console.log(`✅ SavingsPool deployed at: ${poolAddress}`);
    console.log(`   tx hash: ${poolHash}`);

    // --- 3) Link NFT → Pool ---
    console.log('Linking ReceiptNFT to SavingsPool...');
    const linkTx = await walletClient.writeContract({
      address: nftAddress,
      abi: nftArtifact.abi,
      functionName: 'setPool',
      args: [poolAddress],
      ...(feeParams as any),
      // gas: BigInt(150_000),
    });
    await publicClient.waitForTransactionReceipt({ hash: linkTx });
    console.log(`🔗 ReceiptNFT.pool = ${poolAddress}`);

    // --- 4) Persist pool to .env ---
    updateEnvTokenAddress(poolAddress);
    console.log('✅ TOKEN_ADDRESS (SavingsPool) written to .env');

    console.log('\n================= DEPLOYMENT SUMMARY =================');
    console.log(`Deployer:       ${deployer}`);
    console.log(`ReceiptNFT:     ${nftAddress}`);
    console.log(`SavingsPool:    ${poolAddress}`);
    console.log(`Network:        ${await publicClient.getChainId()}`);
    console.log('======================================================\n');

    process.exit(0);
  } catch (e) {
    console.error('❌ Deployment failed:', e);
    process.exit(1);
  }
})();