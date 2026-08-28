const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployPraxisFixture, registerAgent, trailHash, E18 } = require("./helpers/fixture");

const DAY = 24n * 60n * 60n;

describe("ReputationScore", function () {
  async function attestN(ctx, agentId, n, prefix = "t") {
    for (let i = 0; i < n; i++) {
      await ctx.attestation
        .connect(ctx.agentOwner)
        .attest(agentId, trailHash(`${prefix}-${agentId}-${i}`), "TRADE", `action ${i}`);
    }
  }

  it("returns zero for an agent that does not exist", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    expect(await ctx.reputation.scoreOf(1n)).to.equal(0n);
    expect(await ctx.reputation.tierOf(1n)).to.equal("UNTRUSTED");
  });

  it("starts a freshly registered agent at the base score", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const agentId = await registerAgent(ctx, ctx.agentOwner, "Fresh", "uri"); // exactly minBond

    const b = await ctx.reputation.breakdownOf(agentId);
    expect(b.base).to.equal(500n);
    expect(b.attestationBonus).to.equal(0n);
    expect(b.longevityBonus).to.equal(0n);
    expect(b.bondBonus).to.equal(0n);
    expect(b.slashPenalty).to.equal(0n);
    expect(b.score).to.equal(500n);
    expect(await ctx.reputation.tierOf(agentId)).to.equal("NEUTRAL");
  });

  it("rewards clean attestations, capped at MAX_ATTESTATION_BONUS", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const agentId = await registerAgent(ctx, ctx.agentOwner, "Busy", "uri");

    await attestN(ctx, agentId, 10);
    let b = await ctx.reputation.breakdownOf(agentId);
    expect(b.cleanAttestations).to.equal(10n);
    expect(b.attestationBonus).to.equal(50n); // 10 x 5
    expect(b.score).to.equal(550n);

    await attestN(ctx, agentId, 45, "more");
    b = await ctx.reputation.breakdownOf(agentId);
    expect(b.cleanAttestations).to.equal(55n);
    expect(b.attestationBonus).to.equal(250n); // capped
    expect(b.score).to.equal(750n);
    expect(await ctx.reputation.tierOf(agentId)).to.equal("RELIABLE");
  });

  it("rewards longevity, capped at MAX_LONGEVITY_BONUS", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const agentId = await registerAgent(ctx, ctx.agentOwner, "Old", "uri");

    await time.increase(10n * DAY);
    expect((await ctx.reputation.breakdownOf(agentId)).longevityBonus).to.equal(20n); // 10 x 2

    await time.increase(100n * DAY);
    expect((await ctx.reputation.breakdownOf(agentId)).longevityBonus).to.equal(100n); // capped
  });

  it("rewards over-collateralisation, capped at MAX_BOND_BONUS", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { params } = ctx;

    const twoX = await registerAgent(ctx, ctx.agentOwner, "2x", "uri", params.minBond * 2n);
    expect((await ctx.reputation.breakdownOf(twoX)).bondBonus).to.equal(25n);

    const tenX = await registerAgent(ctx, ctx.otherAgentOwner, "10x", "uri", params.minBond * 10n);
    expect((await ctx.reputation.breakdownOf(tenX)).bondBonus).to.equal(100n); // capped at 4x excess
  });

  it("penalises an open dispute and restores the score when it is rejected", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { attestation, dispute, reputation, admin, agentOwner, challenger, params } = ctx;
    const agentId = await registerAgent(ctx, agentOwner, "Accused", "uri", params.minBond * 10n);

    await attestation.connect(agentOwner).attest(agentId, trailHash("a"), "TRADE", "s");
    const clean = await reputation.scoreOf(agentId); // 500 + 5 + 100

    await dispute.connect(challenger).openDispute(1n, "alleged violation");
    let b = await reputation.breakdownOf(agentId);
    expect(b.openDisputes).to.equal(1n);
    expect(b.disputePenalty).to.equal(40n);
    expect(b.score).to.equal(clean - 40n);

    await dispute.connect(admin).resolve(1n, false);
    b = await reputation.breakdownOf(agentId);
    expect(b.openDisputes).to.equal(0n);
    expect(b.disputePenalty).to.equal(0n);
    expect(b.defenseBonus).to.equal(20n); // successfully defended
    expect(b.score).to.equal(clean + 20n);
  });

  it("drops the score sharply on an upheld slash", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { attestation, dispute, reputation, admin, agentOwner, challenger, params } = ctx;
    const agentId = await registerAgent(ctx, agentOwner, "Rogue", "uri", params.minBond * 10n);

    for (const s of ["a", "b", "c"]) {
      await attestation.connect(agentOwner).attest(agentId, trailHash(s), "TRADE", s);
    }
    const before = await reputation.scoreOf(agentId);
    expect(before).to.equal(500n + 15n + 100n); // base + 3 clean + max bond bonus

    await dispute.connect(challenger).openDispute(2n, "policy violation");
    await dispute.connect(admin).resolve(1n, true);

    const b = await reputation.breakdownOf(agentId);
    expect(b.slashCount).to.equal(1n);
    expect(b.slashPenalty).to.equal(150n);
    expect(b.cleanAttestations).to.equal(2n);
    // 20% of the bond burned => severity = 200 * 2000/10000 = 40
    expect(b.severityPenalty).to.equal(40n);
    // 500 + 10 (2 clean) + 100 (bond 8000 vs min 1000 => still capped) - 150 - 40
    expect(b.score).to.equal(420n);
    expect(b.score).to.be.lessThan(before);
    expect(await reputation.tierOf(agentId)).to.equal("NEUTRAL");
  });

  it("zeroes the score for an agent slashed out of the system", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { attestation, dispute, reputation, registry, admin, agentOwner, challenger, params } = ctx;
    const agentId = await registerAgent(ctx, agentOwner, "Thin", "uri", params.minBond + 1n);

    await attestation.connect(agentOwner).attest(agentId, trailHash("bad"), "TRADE", "bad");
    await dispute.connect(challenger).openDispute(1n, "violation");
    await dispute.connect(admin).resolve(1n, true);

    expect(await registry.isActive(agentId)).to.equal(false);
    const b = await reputation.breakdownOf(agentId);
    expect(b.active).to.equal(false);
    expect(b.score).to.equal(0n);
    expect(await reputation.tierOf(agentId)).to.equal("UNTRUSTED");
  });

  it("never returns a negative score", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { registry, attestation, dispute, reputation, admin, agentOwner, challenger, outsider } = ctx;
    // Big bond so repeated 20% slashes keep the agent above the minimum.
    const agentId = await registerAgent(ctx, agentOwner, "Serial", "uri", 100_000n * E18);

    let attestationId = 0n;
    for (let i = 0; i < 4; i++) {
      await attestation.connect(agentOwner).attest(agentId, trailHash(`bad-${i}`), "TRADE", `bad ${i}`);
      attestationId += 1n;
      const who = i % 2 === 0 ? challenger : outsider;
      await dispute.connect(who).openDispute(attestationId, `violation ${i}`);
      await dispute.connect(admin).resolve(BigInt(i + 1), true);
    }

    expect(await registry.isActive(agentId)).to.equal(true);
    const b = await reputation.breakdownOf(agentId);
    expect(b.slashCount).to.equal(4n);
    expect(b.slashPenalty).to.equal(600n);
    expect(b.score).to.equal(0n); // clamped, not underflowed
    expect(await reputation.tierOf(agentId)).to.equal("UNTRUSTED");
  });

  it("caps the score at MAX_SCORE", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { reputation, agentOwner, params } = ctx;
    const agentId = await registerAgent(ctx, agentOwner, "Star", "uri", params.minBond * 10n);

    await attestN(ctx, agentId, 60);
    await time.increase(100n * DAY);

    const b = await reputation.breakdownOf(agentId);
    // 500 + 250 + 100 + 100 = 950, under the cap; confirm the cap holds anyway.
    expect(b.score).to.equal(950n);
    expect(b.score).to.be.lessThanOrEqual(await reputation.MAX_SCORE());
    expect(await reputation.tierOf(agentId)).to.equal("TRUSTED");
  });

  it("batch-reads scores for the agent list view", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { reputation, agentOwner, otherAgentOwner, params } = ctx;
    const a = await registerAgent(ctx, agentOwner, "A", "uri");
    const b = await registerAgent(ctx, otherAgentOwner, "B", "uri", params.minBond * 3n);

    expect(await reputation.scoresOf([a, b, 99n])).to.deep.equal([500n, 550n, 0n]);
  });

  it("only lets the owner repoint the dispute module", async function () {
    const ctx = await loadFixture(deployPraxisFixture);
    const { reputation, admin, outsider, dispute } = ctx;

    await expect(reputation.connect(outsider).setDisputeModule(outsider.address)).to.be.revertedWithCustomError(
      reputation,
      "OwnableUnauthorizedAccount"
    );
    await expect(reputation.connect(admin).setDisputeModule(outsider.address))
      .to.emit(reputation, "DisputeModuleUpdated")
      .withArgs(await dispute.getAddress(), outsider.address);
  });
});
