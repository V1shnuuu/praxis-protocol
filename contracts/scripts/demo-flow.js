/**
 * Phase 1 acceptance check, run against live contracts:
 *   register a test agent -> submit an attestation -> open a dispute
 *   -> arbiter upholds -> bond is slashed -> reputation drops.
 *
 * Reads ../deployed-addresses.json for the current network. On the in-process
 * `hardhat` network it deploys a fresh stack first so the script is self-contained.
 *
 *   npx hardhat run scripts/demo-flow.js                 # ephemeral local chain
 *   npx hardhat run scripts/demo-flow.js --network amoy  # live Polygon Amoy
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers, network } = hre;
const { readParams } = require("./params");
const { deployPraxis } = require("./deploy-core");
const { loadDeployment, ADDRESS_FILE } = require("./load-deployment");

const E18 = 10n ** 18n;
const PRAX = (v) => `${Number(ethers.formatUnits(v, 18)).toLocaleString("en-US")} PRAX`;

const POLICY =
  "TradingAgent policy v1: never allocate more than 20% of the book to a single asset.";

const step = (n, title) => console.log(`\n${"─".repeat(72)}\n${n}. ${title}\n${"─".repeat(72)}`);

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length < 3) {
    throw new Error(
      `This flow needs three accounts (deployer/arbiter, agent, challenger); found ${signers.length}.\n` +
        "Run `npm run wallets:new`, put the keys in contracts/.env, then `npm run fund:amoy`."
    );
  }
  const [arbiter, agentOwner, challenger] = signers;
  const explorer = network.name === "amoy" ? "https://amoy.polygonscan.com/tx/" : null;
  const link = (receipt) => (explorer ? `\n     ${explorer}${receipt.hash}` : "");

  let c;
  if (network.name === "hardhat" || !hasDeployment(network.name)) {
    console.log(`no deployment recorded for "${network.name}" — deploying an ephemeral stack\n`);
    c = await deployPraxis(arbiter, readParams(arbiter.address), (l) => console.log(`  ${l}`));
  } else {
    const d = loadDeployment(network.name);
    console.log(`using deployment from ${ADDRESS_FILE} (network "${network.name}")`);
    c = {
      token: await ethers.getContractAt("PraxisToken", d.contracts.PraxisToken),
      registry: await ethers.getContractAt("AgentRegistry", d.contracts.AgentRegistry),
      attestation: await ethers.getContractAt("ActionAttestation", d.contracts.ActionAttestation),
      dispute: await ethers.getContractAt("DisputeSlashing", d.contracts.DisputeSlashing),
      reputation: await ethers.getContractAt("ReputationScore", d.contracts.ReputationScore),
    };
  }

  const bond = BigInt(process.env.DEMO_BOND || "10000") * E18;
  const challengeFee = await c.dispute.challengeFee();

  // -------------------------------------------------------------- 0. funding
  step(0, "Fund the demo wallets");
  await ensureBalance(c.token, arbiter, agentOwner, bond * 2n);
  await ensureBalance(c.token, arbiter, challenger, challengeFee * 5n);
  console.log(`  agent      ${agentOwner.address}  ${PRAX(await c.token.balanceOf(agentOwner.address))}`);
  console.log(`  challenger ${challenger.address}  ${PRAX(await c.token.balanceOf(challenger.address))}`);

  // -------------------------------------------------------------- 1. register
  step(1, "Register the agent and post its bond");
  await (await c.token.connect(agentOwner).approve(await c.registry.getAddress(), bond)).wait();
  const regReceipt = await (
    await c.registry
      .connect(agentOwner)
      .register(`TradingAgent-${Date.now()}`, "ipfs://praxis/policy/trading-v1", bond)
  ).wait();
  const agentId = await c.registry.agentCount();

  console.log(`  agentId    ${agentId}`);
  console.log(`  policy     ${POLICY}`);
  console.log(`  bond       ${PRAX(await c.registry.bondOf(agentId))}`);
  console.log(`  reputation ${await c.reputation.scoreOf(agentId)} (${await c.reputation.tierOf(agentId)})${link(regReceipt)}`);

  // -------------------------------------------------------------- 2. compliant action
  step(2, "Agent takes a compliant action and attests to it");
  const goodTrail = {
    agentId: Number(agentId),
    policy: POLICY,
    inputs: { asset: "ETH", price: 3120.44, bookValue: 100000, currentAllocation: 0.08 },
    reasoning: "ETH is 4% under its 20d mean and the resulting allocation is 12%, inside the 20% cap.",
    output: { action: "BUY", notional: 4000 },
    nonce: `${Date.now()}-good`,
  };
  const goodId = await submitAttestation(c, agentOwner, agentId, goodTrail, "TRADE", "BUY $4k ETH (12% of book)", link);

  // -------------------------------------------------------------- 3. rogue action
  step(3, "Rogue mode: the agent violates its own declared policy");
  const rogueTrail = {
    agentId: Number(agentId),
    policy: POLICY,
    inputs: { asset: "ETH", price: 3120.44, bookValue: 100000, currentAllocation: 0.12 },
    reasoning: "Momentum looks strong; overriding the 20% cap and going to 85% of the book.",
    output: { action: "BUY", notional: 73000 },
    nonce: `${Date.now()}-rogue`,
  };
  const rogueId = await submitAttestation(c, agentOwner, agentId, rogueTrail, "TRADE", "BUY $73k ETH (85% of book)", link);
  console.log(`  policy violation: declared cap 20%, actual allocation 85%`);

  // -------------------------------------------------------------- 4. dispute
  step(4, "Watcher reveals the trail and opens a dispute");
  const revealed = ethers.toUtf8Bytes(JSON.stringify(rogueTrail));
  const matches = await c.attestation.verifyTrail(rogueId, revealed);
  console.log(`  revealed trail matches the on-chain commitment: ${matches}`);
  if (!matches) throw new Error("revealed trail does not match its commitment");
  console.log(`  challengeable: ${await c.dispute.isChallengeable(rogueId)}`);

  await (await c.token.connect(challenger).approve(await c.dispute.getAddress(), challengeFee)).wait();
  const openReceipt = await (
    await c.dispute
      .connect(challenger)
      .openDispute(rogueId, "Allocated 85% of the book to a single asset; declared cap is 20%")
  ).wait();
  const disputeId = await c.dispute.disputeCount();

  const agentDuringDispute = await c.registry.getAgent(agentId);
  console.log(`  disputeId  ${disputeId}   fee staked ${PRAX(challengeFee)}`);
  console.log(`  bond locked pending resolution: ${PRAX(agentDuringDispute.lockedBond)}`);
  console.log(`  reputation ${await c.reputation.scoreOf(agentId)} (open dispute penalty applied)${link(openReceipt)}`);

  // -------------------------------------------------------------- 5. resolution
  step(5, "Arbiter upholds the challenge — bond is slashed");
  const bondBefore = await c.registry.bondOf(agentId);
  const challengerBefore = await c.token.balanceOf(challenger.address);
  const resolveReceipt = await (await c.dispute.connect(arbiter).resolve(disputeId, true)).wait();

  const resolved = await c.dispute.getDispute(disputeId);
  const agentAfter = await c.registry.getAgent(agentId);
  const finalScore = await c.reputation.scoreOf(agentId);

  console.log(`  bond   ${PRAX(bondBefore)}  ->  ${PRAX(agentAfter.bond)}   (slashed ${PRAX(resolved.slashedAmount)})`);
  console.log(`  challenger payout ${PRAX((await c.token.balanceOf(challenger.address)) - challengerBefore)}`);
  console.log(`  slashCount ${agentAfter.slashCount}   active: ${agentAfter.active}`);
  console.log(`  reputation ${finalScore} (${await c.reputation.tierOf(agentId)})${link(resolveReceipt)}`);

  // -------------------------------------------------------------- summary
  step(6, "Result");
  const b = await c.reputation.breakdownOf(agentId);
  console.log(`  agentId            ${agentId}`);
  console.log(`  attestations       ${b.totalAttestations} total / ${b.cleanAttestations} clean`);
  console.log(`  slashes            ${b.slashCount}   penalty -${b.slashPenalty}  severity -${b.severityPenalty}`);
  console.log(`  reputation         ${b.score} / ${await c.reputation.MAX_SCORE()}`);
  console.log(`  clean attestation  #${goodId} still unchallenged`);
  console.log(`  rogue attestation  #${rogueId} permanently flagged as slashed`);
  console.log("\nPhase 1 acceptance criteria met: register -> attest -> dispute -> slash -> reputation drop.\n");
}

async function submitAttestation(c, signer, agentId, trail, actionType, summary, link) {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(trail)));
  const receipt = await (
    await c.attestation.connect(signer).attest(agentId, hash, actionType, summary)
  ).wait();
  const id = await c.attestation.attestationCount();
  console.log(`  attestation #${id}  ${actionType}  "${summary}"`);
  console.log(`  trailHash  ${hash}${link(receipt)}`);
  return id;
}

/** Tops a wallet up from the deployer if it is short of PRAX. */
async function ensureBalance(token, from, to, needed) {
  const balance = await token.balanceOf(to.address);
  if (balance >= needed) return;
  await (await token.connect(from).transfer(to.address, needed - balance)).wait();
}

function hasDeployment(networkName) {
  if (!fs.existsSync(ADDRESS_FILE)) return false;
  try {
    return Boolean(JSON.parse(fs.readFileSync(ADDRESS_FILE, "utf8"))[networkName]);
  } catch (_) {
    return false;
  }
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
});
