/**
 * Generates the two auxiliary demo wallets (agent + challenger) and prints the
 * lines to paste into contracts/.env. Nothing is written to disk: the keys are
 * yours to store. Testnet only — never reuse these for anything with value.
 */
const { ethers } = require("hardhat");

function main() {
  const agent = ethers.Wallet.createRandom();
  const challenger = ethers.Wallet.createRandom();

  console.log("Generated two fresh testnet wallets. Paste into contracts/.env:\n");
  console.log(`AGENT_PRIVATE_KEY=${agent.privateKey}`);
  console.log(`CHALLENGER_PRIVATE_KEY=${challenger.privateKey}`);
  console.log("\nAddresses:");
  console.log(`  agent      ${agent.address}`);
  console.log(`  challenger ${challenger.address}`);
  console.log("\nThen run `npm run fund:amoy` to send them POL for gas and PRAX for bonds.");
}

main();
