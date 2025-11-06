#!/usr/bin/env ts-node
import { Address } from 'viem';
import { loadArtifact, makeClients, parseUnits18, fees, requireEnv, maybeEnv, updateEnvTokenAddress } from './_utils';

(async () => {
  try {
    // CHANGE: default to GrantProposal (was BankMintToken)
    const CONTRACT_NAME = process.env.CONTRACT_NAME ?? "GrantProposal";
    // Ensure utils that read env can see the intended name
    process.env.CONTRACT_NAME = CONTRACT_NAME;

    const { abi, bytecode } = await loadArtifact();

    const { publicClient, walletClient } = makeClients();
    const name = requireEnv('TOKEN_NAME');
    const symbol = requireEnv('TOKEN_SYMBOL');
    const capHuman = requireEnv('TOKEN_CAP');
    const initialMintHuman = requireEnv('INITIAL_MINT');
    const cap = parseUnits18(capHuman);
    const initialMint = parseUnits18(initialMintHuman);

    const defaultReceiver = (await walletClient.getAddresses())[0] as Address;
    const initialReceiver = (maybeEnv('INITIAL_RECEIVER') as Address) || defaultReceiver;

    // Legacy gas price (unchanged)
    const gasPrice = BigInt(2_000_000_000); // 2 gwei

    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args: [name, symbol, cap, initialReceiver, initialMint],
      gasPrice,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const address = receipt.contractAddress as Address;
    if (!address) {
      console.error('No contractAddress in receipt; deployment failed.');
      process.exit(1);
    }

    console.log('Deploy tx hash:', hash);
    console.log('Deployed contract address:', address);
    console.log('Block number:', receipt.blockNumber.toString());

    // Write TOKEN_ADDRESS into .env
    updateEnvTokenAddress(address);
    console.log('TOKEN_ADDRESS written to .env');

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();