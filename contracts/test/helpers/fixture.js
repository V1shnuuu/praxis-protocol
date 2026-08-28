const { ethers } = require("hardhat");

const E18 = 10n ** 18n;

const PARAMS = {
  minBond: 1_000n * E18,
  challengeWindow: 300n, // 5 minutes — short so live demos are fast
  challengeFee: 100n * E18,
  slashBps: 2_000n, // 20% of remaining bond
  challengerRewardBps: 5_000n, // challenger keeps half the slash
  initialSupply: 10_000_000n * E18,
};

/**
 * Deploys the full Praxis stack and funds the test signers.
 * Mirrors scripts/deploy.js so the tests exercise the real wiring.
 */
async function deployPraxisFixture() {
  const [admin, agentOwner, otherAgentOwner, orchestrator, challenger, treasury, outsider] =
    await ethers.getSigners();

  const token = await ethers.deployContract("PraxisToken", [admin.address, PARAMS.initialSupply]);
  await token.waitForDeployment();

  const registry = await ethers.deployContract("AgentRegistry", [
    await token.getAddress(),
    PARAMS.minBond,
    admin.address,
  ]);
  await registry.waitForDeployment();

  const attestation = await ethers.deployContract("ActionAttestation", [
    await registry.getAddress(),
    admin.address,
  ]);
  await attestation.waitForDeployment();

  const dispute = await ethers.deployContract("DisputeSlashing", [
    await registry.getAddress(),
    await attestation.getAddress(),
    await token.getAddress(),
    admin.address, // arbiter
    treasury.address,
    PARAMS.challengeWindow,
    PARAMS.challengeFee,
    PARAMS.slashBps,
    PARAMS.challengerRewardBps,
    admin.address,
  ]);
  await dispute.waitForDeployment();

  const reputation = await ethers.deployContract("ReputationScore", [
    await registry.getAddress(),
    await attestation.getAddress(),
    await dispute.getAddress(),
    admin.address,
  ]);
  await reputation.waitForDeployment();

  // Wiring
  await registry.connect(admin).setSlasher(await dispute.getAddress());
  await attestation.connect(admin).setDisputeModule(await dispute.getAddress());

  // Fund and approve every actor that posts tokens.
  const funded = [agentOwner, otherAgentOwner, challenger, outsider];
  for (const signer of funded) {
    await token.connect(admin).transfer(signer.address, 100_000n * E18);
    await token.connect(signer).approve(await registry.getAddress(), ethers.MaxUint256);
    await token.connect(signer).approve(await dispute.getAddress(), ethers.MaxUint256);
  }

  return {
    token,
    registry,
    attestation,
    dispute,
    reputation,
    admin,
    agentOwner,
    otherAgentOwner,
    orchestrator,
    challenger,
    treasury,
    outsider,
    params: PARAMS,
  };
}

/** Registers an agent with a bond and returns its id. */
async function registerAgent(ctx, signer, name, metadataURI, bond) {
  const tx = await ctx.registry
    .connect(signer)
    .register(name, metadataURI, bond ?? ctx.params.minBond);
  await tx.wait();
  return await ctx.registry.agentCount();
}

/** Hash of a decision trail, matching what the backend commits. */
function trailHash(payload) {
  return ethers.keccak256(ethers.toUtf8Bytes(typeof payload === "string" ? payload : JSON.stringify(payload)));
}

module.exports = { deployPraxisFixture, registerAgent, trailHash, PARAMS, E18 };
