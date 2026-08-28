const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network, artifacts } = hre;
const { readParams, E18 } = require("./params");
const { deployPraxis } = require("./deploy-core");

const ROOT = path.resolve(__dirname, "..", "..");
const ADDRESS_FILE = path.join(ROOT, "deployed-addresses.json");
const ABI_DIR = path.join(ROOT, "deployments", "abis");

const CONTRACT_NAMES = [
  "PraxisToken",
  "AgentRegistry",
  "ActionAttestation",
  "DisputeSlashing",
  "ReputationScore",
];

const fmt = (v) => `${ethers.formatUnits(v, 18)}`;

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available. Set DEPLOYER_PRIVATE_KEY in contracts/.env before deploying to a live network."
    );
  }

  const params = readParams(deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  // Read the chain id from the node rather than the config, so it is always accurate.
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log("=".repeat(72));
  console.log("Praxis Protocol deployment");
  console.log("=".repeat(72));
  console.log(`network        : ${network.name} (chainId ${chainId})`);
  console.log(`deployer       : ${deployer.address}`);
  console.log(`balance        : ${ethers.formatEther(balance)} ${network.name === "amoy" ? "POL" : "ETH"}`);
  console.log(`arbiter        : ${params.arbiter}`);
  console.log(`treasury       : ${params.treasury}`);
  console.log(`minBond        : ${fmt(params.minBond)} PRAX`);
  console.log(`challengeWindow: ${params.challengeWindow}s`);
  console.log(`challengeFee   : ${fmt(params.challengeFee)} PRAX`);
  console.log(`slashBps       : ${params.slashBps} (${Number(params.slashBps) / 100}%)`);
  console.log(`rewardBps      : ${params.challengerRewardBps} (${Number(params.challengerRewardBps) / 100}% of the slash)`);
  console.log("-".repeat(72));

  if (balance === 0n && network.name !== "hardhat") {
    throw new Error(
      "Deployer has no native balance. Fund it with test POL from https://faucet.polygon.technology (Polygon Amoy)."
    );
  }

  const { token, registry, attestation, dispute, reputation } = await deployPraxis(
    deployer,
    params,
    (line) => console.log(line)
  );

  const deploymentBlock = await ethers.provider.getBlockNumber();

  const record = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    deploymentBlock,
    explorer: network.name === "amoy" ? "https://amoy.polygonscan.com" : null,
    contracts: {
      PraxisToken: await token.getAddress(),
      AgentRegistry: await registry.getAddress(),
      ActionAttestation: await attestation.getAddress(),
      DisputeSlashing: await dispute.getAddress(),
      ReputationScore: await reputation.getAddress(),
    },
    params: {
      arbiter: params.arbiter,
      treasury: params.treasury,
      minBond: params.minBond.toString(),
      minBondFormatted: fmt(params.minBond),
      challengeWindowSeconds: Number(params.challengeWindow),
      challengeFee: params.challengeFee.toString(),
      challengeFeeFormatted: fmt(params.challengeFee),
      slashBps: Number(params.slashBps),
      challengerRewardBps: Number(params.challengerRewardBps),
      tokenDecimals: 18,
      tokenSymbol: "PRAX",
    },
  };

  await writeAddresses(record);
  await exportAbis();

  console.log("-".repeat(72));
  console.log(`addresses -> ${path.relative(ROOT, ADDRESS_FILE)} (key: "${network.name}")`);
  console.log(`ABIs      -> ${path.relative(ROOT, ABI_DIR)}/`);
  if (record.explorer) {
    console.log("-".repeat(72));
    for (const [name, address] of Object.entries(record.contracts)) {
      console.log(`  ${name.padEnd(18)} ${record.explorer}/address/${address}`);
    }
    console.log("-".repeat(72));
    console.log("next: npm run verify:amoy   (needs POLYGONSCAN_API_KEY)");
    console.log("      npm run demo:amoy     (register -> attest -> dispute -> slash)");
  }
  console.log("done.");
  void E18;
}

/** Merges this deployment into the shared address book, keyed by network name. */
async function writeAddresses(record) {
  let book = {};
  if (fs.existsSync(ADDRESS_FILE)) {
    try {
      book = JSON.parse(fs.readFileSync(ADDRESS_FILE, "utf8"));
    } catch (_) {
      book = {};
    }
  }
  book[record.network] = record;
  fs.mkdirSync(path.dirname(ADDRESS_FILE), { recursive: true });
  fs.writeFileSync(ADDRESS_FILE, `${JSON.stringify(book, null, 2)}\n`);
}

/** Writes plain ABI JSON the Python backend and the Next.js frontend can both import. */
async function exportAbis() {
  fs.mkdirSync(ABI_DIR, { recursive: true });
  for (const name of CONTRACT_NAMES) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(ABI_DIR, `${name}.json`),
      `${JSON.stringify({ contractName: name, abi: artifact.abi }, null, 2)}\n`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
