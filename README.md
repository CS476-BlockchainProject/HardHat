# HardHat

# How to run locally
```bash
Deploy Contract
npx hardhat run scripts/deploy2.ts --network didlab

Transfer Tokens
npx hardhat run scripts/transfer-approve2.ts --network didlab

Compare Airdrops vs Single Transactions
npx hardhat run scripts/airdropVsSingles.ts --network didlab

View Transaction Logs
npx hardhat run scripts/logs-query.ts --network didlab

Send Transaction
npx hardhat run scripts/send-op-tx.ts --network didlab
```

# How to run tests
```bash
Ensure you run this first: npm i -D hardhat @nomicfoundation/hardhat-toolbox-viem typescript ts-node chai @types/chai
npm test
npx hardhat test
or specfically: npx hardhat test test/BankMintToken.ts
```


# How to run CLI
```bash
npm run cli     
```

# How to run metrics
```bash
npm run metric:perf
```
