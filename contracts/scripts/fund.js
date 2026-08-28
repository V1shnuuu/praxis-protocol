/**
 * Tops up the agent and challenger wallets from the deployer:
 *   - native POL for gas
 *   - PRAX for bonds and challenge fees
 * Reads addresses from ../deployed-addresses.json for the current network.
 */
const hre = require("hardhat");
const { ethers, network } = hre;
const { loadDeployment } = require("./load-deployment");

const E18 = 10n ** 18n;
const GAS_TOP_UP = ethers.parseEther(process.env.GAS_TOP_UP || "0.05");
const PRAX_TOP_UP = BigInt(process.env.PRAX_TOP_UP || "50000") * E18;

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, agent, challenger] = signers;

  if (signers.length < 3) {
    throw new Error(
      `Expected 3 configured accounts, found ${signers.length}. ` +
        "Run `npm run wallets:new` and set AGENT_PRIVATE_KEY and CHALLENGER_PRIVATE_KEY in contracts/.env."
    );
  }

  const deployment = loadDeployment(network.name);
  const token = await ethers.getContractAt("PraxisToken", deployment.contracts.PraxisToken, deployer);

  console.log(`funding demo wallets on ${network.name}`);
  for (const [label, wallet] of [
    ["agent", agent],
    ["challenger", challenger],
  ]) {
    const nativeBalance = await ethers.provider.getBalance(wallet.address);
    if (nativeBalance < GAS_TOP_UP) {
      const tx = await deployer.sendTransaction({
        to: wallet.address,
        value: GAS_TOP_UP - nativeBalance,
      });
      await tx.wait();
      console.log(`  ${label.padEnd(11)} +${ethers.formatEther(GAS_TOP_UP - nativeBalance)} native gas`);
    } else {
      console.log(`  ${label.padEnd(11)} gas already funded (${ethers.formatEther(nativeBalance)})`);
    }

    const praxBalance = await token.balanceOf(wallet.address);
    if (praxBalance < PRAX_TOP_UP) {
      const tx = await token.transfer(wallet.address, PRAX_TOP_UP - praxBalance);
      await tx.wait();
      console.log(
        `  ${label.padEnd(11)} +${ethers.formatUnits(PRAX_TOP_UP - praxBalance, 18)} PRAX`
      );
    } else {
      console.log(`  ${label.padEnd(11)} PRAX already funded (${ethers.formatUnits(praxBalance, 18)})`);
    }
  }
  console.log("done.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
