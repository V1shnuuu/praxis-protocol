/**
 * Submits every deployed contract's source to PolygonScan for verification,
 * reading addresses and constructor arguments from ../deployed-addresses.json.
 *
 *   POLYGONSCAN_API_KEY=... npm run verify:amoy
 *
 * Already-verified contracts are reported and skipped rather than failing the run.
 */
const hre = require("hardhat");
const { network } = hre;
const { loadDeployment } = require("./load-deployment");

async function main() {
  if (!process.env.POLYGONSCAN_API_KEY) {
    throw new Error(
      "POLYGONSCAN_API_KEY is not set. Get a free key at https://polygonscan.com/myapikey " +
        "and add it to contracts/.env, or follow the manual steps in the README."
    );
  }

  const d = loadDeployment(network.name);
  const p = d.params;
  const c = d.contracts;

  const targets = [
    { name: "PraxisToken", address: c.PraxisToken, args: [d.deployer, "10000000000000000000000000"] },
    { name: "AgentRegistry", address: c.AgentRegistry, args: [c.PraxisToken, p.minBond, d.deployer] },
    { name: "ActionAttestation", address: c.ActionAttestation, args: [c.AgentRegistry, d.deployer] },
    {
      name: "DisputeSlashing",
      address: c.DisputeSlashing,
      args: [
        c.AgentRegistry,
        c.ActionAttestation,
        c.PraxisToken,
        p.arbiter,
        p.treasury,
        p.challengeWindowSeconds,
        p.challengeFee,
        p.slashBps,
        p.challengerRewardBps,
        d.deployer,
      ],
    },
    {
      name: "ReputationScore",
      address: c.ReputationScore,
      args: [c.AgentRegistry, c.ActionAttestation, c.DisputeSlashing, d.deployer],
    },
  ];

  for (const target of targets) {
    process.stdout.write(`verifying ${target.name.padEnd(18)} ${target.address} ... `);
    try {
      await hre.run("verify:verify", { address: target.address, constructorArguments: target.args });
      console.log("ok");
    } catch (error) {
      const message = String(error.message || error);
      if (/already verified/i.test(message)) {
        console.log("already verified");
      } else {
        console.log(`FAILED\n  ${message.split("\n")[0]}`);
      }
    }
  }

  if (d.explorer) {
    console.log(`\nBrowse the verified sources at ${d.explorer}/address/${c.AgentRegistry}#code`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
