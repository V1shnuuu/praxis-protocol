const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployPraxisFixture, trailHash, E18 } = require("./helpers/fixture");

/**
 * The full Praxis demo storyline, end to end:
 *   register -> operate cleanly -> go rogue -> watcher disputes -> arbiter upholds
 *   -> bond slashed, challenger paid, reputation collapses.
 */
describe("Praxis end-to-end demo flow", function () {
  const POLICY = "Never allocate more than 20% of the book to a single asset.";

  function buildTrail(step, decision, reasoning) {
    return {
      step,
      policy: POLICY,
      inputs: { asset: "ETH", price: 3120.44 },
      reasoning,
      output: decision,
    };
  }

  it("runs register -> attest -> rogue -> dispute -> slash -> reputation drop", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { registry, attestation, dispute, reputation, token, admin, agentOwner, orchestrator, challenger, treasury } =
      ctx;

    // 1. The agent registers with a 10 000 PRAX bond and delegates to the orchestrator.
    const bond = 10_000n * E18;
    await registry.connect(agentOwner).register("TradingAgent", "ipfs://policy/trading-v1", bond);
    const agentId = await registry.agentCount();
    await registry.connect(agentOwner).setOperator(agentId, orchestrator.address, true);

    expect(await reputation.scoreOf(agentId)).to.equal(600n); // 500 base + 100 bond bonus

    // 2. Three compliant decisions, committed by the orchestrator.
    for (let i = 0; i < 3; i++) {
      const trail = buildTrail(i, { action: "BUY", size: 0.04 }, "Position stays inside the 20% cap.");
      await attestation
        .connect(orchestrator)
        .attest(agentId, trailHash(trail), "TRADE", `BUY 0.04 ETH (step ${i})`);
    }
    expect(await attestation.totalByAgent(agentId)).to.equal(3n);

    const cleanScore = await reputation.scoreOf(agentId);
    expect(cleanScore).to.equal(615n); // + 3 clean attestations

    // 3. Rogue mode: the agent blows through its declared cap.
    const rogueTrail = buildTrail(3, { action: "BUY", size: 8.5 }, "Ignoring the cap to chase momentum.");
    const rogueHash = trailHash(rogueTrail);
    await attestation
      .connect(orchestrator)
      .attest(agentId, rogueHash, "TRADE", "BUY 8.5 ETH (85% of book)");
    const rogueId = await attestation.attestationCount();

    // The off-chain trail still hashes to the on-chain commitment: the evidence is verifiable.
    expect(
      await attestation.verifyTrail(rogueId, ethers.toUtf8Bytes(JSON.stringify(rogueTrail)))
    ).to.equal(true);

    // 4. The watcher opens a dispute inside the challenge window.
    expect(await dispute.isChallengeable(rogueId)).to.equal(true);
    await dispute
      .connect(challenger)
      .openDispute(rogueId, "Allocated 85% of the book to ETH, declared cap is 20%");
    const disputeId = await dispute.disputeCount();

    expect((await attestation.getAttestation(rogueId)).disputed).to.equal(true);
    expect((await registry.getAgent(agentId)).lockedBond).to.equal(2_000n * E18);
    const underDisputeScore = await reputation.scoreOf(agentId);
    expect(underDisputeScore).to.equal(cleanScore + 5n - 40n); // + rogue attestation, - open dispute

    // 5. The arbiter upholds the challenge.
    const challengerBefore = await token.balanceOf(challenger.address);
    const treasuryBefore = await token.balanceOf(treasury.address);
    await dispute.connect(admin).resolve(disputeId, true);

    // 6. On-chain consequences.
    const slashed = 2_000n * E18;
    const payout = 1_000n * E18 + 100n * E18; // half the slash + the returned fee
    expect(await registry.bondOf(agentId)).to.equal(bond - slashed);
    expect(await token.balanceOf(challenger.address)).to.equal(challengerBefore + payout);
    expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore + (slashed - 1_000n * E18));
    expect((await attestation.getAttestation(rogueId)).slashed).to.equal(true);

    const finalScore = await reputation.scoreOf(agentId);
    expect(finalScore).to.equal(425n); // 500 + 15 + 100 - 150 - 40
    expect(finalScore).to.be.lessThan(cleanScore);
    expect(await reputation.tierOf(agentId)).to.equal("NEUTRAL");

    // 7. The record is auditable: the resolved dispute carries the before/after bond.
    const d = await dispute.getDispute(disputeId);
    expect(d.status).to.equal(2n); // Upheld
    expect(d.bondBefore).to.equal(bond);
    expect(d.bondAfter).to.equal(bond - slashed);
    expect(d.slashedAmount).to.equal(slashed);
    expect(d.challengerPayout).to.equal(payout);
  });

  it("keeps an honest agent whole when a challenge is rejected", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { registry, attestation, dispute, reputation, admin, otherAgentOwner, challenger, params } = ctx;

    const bond = 5_000n * E18;
    await registry.connect(otherAgentOwner).register("DAOVotingAgent", "ipfs://policy/dao-v1", bond);
    const agentId = await registry.agentCount();

    const trail = buildTrail(0, { action: "YES" }, "Proposal is inside the mandate.");
    await attestation
      .connect(otherAgentOwner)
      .attest(agentId, trailHash(trail), "VOTE", "YES on PIP-42");
    const before = await reputation.scoreOf(agentId);

    await dispute.connect(challenger).openDispute(1n, "Claimed the vote breached the mandate");
    await dispute.connect(admin).resolve(1n, false);

    // Bond is untouched and grows by the forfeited fee; reputation ends higher than it started.
    expect(await registry.bondOf(agentId)).to.equal(bond + params.challengeFee);
    expect((await registry.getAgent(agentId)).slashCount).to.equal(0n);
    expect(await reputation.scoreOf(agentId)).to.equal(before + 20n);
  });

  it("conserves tokens across the whole flow", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { registry, attestation, dispute, token, admin, agentOwner, challenger } = ctx;

    const accounts = [
      agentOwner.address,
      challenger.address,
      ctx.treasury.address,
      admin.address,
      await registry.getAddress(),
      await dispute.getAddress(),
    ];
    const total = async () => {
      let sum = 0n;
      for (const a of accounts) sum += await token.balanceOf(a);
      return sum;
    };

    const supplyBefore = await token.totalSupply();
    const trackedBefore = await total();

    await registry.connect(agentOwner).register("A", "uri", 10_000n * E18);
    await attestation.connect(agentOwner).attest(1n, trailHash("bad"), "TRADE", "bad");
    await dispute.connect(challenger).openDispute(1n, "violation");
    await dispute.connect(admin).resolve(1n, true);

    expect(await token.totalSupply()).to.equal(supplyBefore);
    expect(await total()).to.equal(trackedBefore);
    expect(await token.balanceOf(await dispute.getAddress())).to.equal(0n);
  });
});
