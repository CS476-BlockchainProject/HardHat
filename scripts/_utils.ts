import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseGwei,
  defineChain,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { Address } from 'viem';
import fs from 'fs';
import path from 'path';

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

export function maybeEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export function parseUnits18(human: string | number): bigint {
  return parseEther(String(human));
}

export function fees() {
  const maxFeePerGas = parseGwei(requireEnv('MAX_FEE_GWEI'));
  const maxPriorityFeePerGas = parseGwei(requireEnv('PRIORITY_FEE_GWEI'));
  return { maxFeePerGas, maxPriorityFeePerGas } as const;
}

// Build a Chain from .env 
export function makeChain() {
  const id = Number(requireEnv('CHAIN_ID'));
  const url = requireEnv('RPC_URL');
  return defineChain({
    id,
    name: `chain-${id}`,
    network: `chain-${id}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [url] },
      public: { http: [url] },
    },
  });
}

export function makeClients() {
  const chain = makeChain();
  const transport = http(requireEnv('RPC_URL'));
  const publicClient = createPublicClient({ chain, transport });

  // wallet account must be an Account object
  const account = privateKeyToAccount(requireEnv('PRIVATE_KEY') as Hex);
  const walletClient = createWalletClient({ chain, account, transport });

  return { publicClient, walletClient, chain };
}

export function loadArtifact() {
  const p = path.join(process.cwd(), 'artifacts', 'contracts', 'CampusCreditV2.sol', 'CampusCreditV2.json');
  if (!fs.existsSync(p)) {
    console.error(`Artifact not found at ${p}. Did you run "npx hardhat compile"?`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const abi = raw.abi;
  const bytecode: Hex = raw.bytecode;
  return { abi, bytecode };
}

export function updateEnvTokenAddress(addr: Address) {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`.env not found at ${envPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(envPath, 'utf8');
  const hasKey = /^TOKEN_ADDRESS\s*=.*$/m.test(text);
  const line = `TOKEN_ADDRESS=${addr}`;
  const newText = hasKey ? text.replace(/^TOKEN_ADDRESS\s*=.*$/m, line) : text.trimEnd() + `\n${line}\n`;
  fs.writeFileSync(envPath, newText, 'utf8');
}

export function fmtAmount(v: bigint) {
  return v.toString() + ' wei';
}
