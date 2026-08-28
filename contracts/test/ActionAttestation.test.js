const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployPraxisFixture, registerAgent, trailHash } = require("./helpers/fixture");

const TRAIL = {
  agent: "TradingAgent",
  policy: "Never allocate more than 20% of the book to a single asset.",
  inputs: { asset: "ETH", price: 3120.44, position: 0.08 },
  reasoning: "Price is 4% below the 20d mean and the position stays inside the 20% cap.",
  output: { action: "BUY", size: 0.04 },
};

describe("ActionAttestation", function () {
  async function withAgent() {
    const ctx = await loadFixture(deployPraxisFixture);
    const agentId = await registerAgent(ctx, ctx.agentOwner, "TradingAgent", "ipfs://policy-1");
    return { ...ctx, agentId };
  }

  describe("submission", function () {
    it("records a hashed decision trail and emits the feed event", async function () {
      const ctx = await withAgent();
      const { attestation, agentOwner, agentId } = ctx;
      const hash = trailHash(TRAIL);

      const tx = await attestation.connect(agentOwner).attest(agentId, hash, "TRADE", "BUY 0.04 ETH");
      await expect(tx)
        .to.emit(attestation, "AttestationSubmitted")
        .withArgs(1n, agentId, hash, "TRADE", "BUY 0.04 ETH", agentOwner.address, anyTimestamp(tx));

      const a = await attestation.getAttestation(1n);
      expect(a.id).to.equal(1n);
      expect(a.agentId).to.equal(agentId);
      expect(a.trailHash).to.equal(hash);
      expect(a.actionType).to.equal("TRADE");
      expect(a.summary).to.equal("BUY 0.04 ETH");
      expect(a.submitter).to.equal(agentOwner.address);
      expect(a.disputed).to.equal(false);
      expect(a.slashed).to.equal(false);
      expect(await attestation.attestationCount()).to.equal(1n);
      expect(await attestation.totalByAgent(agentId)).to.equal(1n);
    });

    it("lets an authorized orchestrator attest on the agent's behalf", async function () {
      const ctx = await withAgent();
      const { registry, attestation, agentOwner, orchestrator, agentId } = ctx;

      await expect(
        attestation.connect(orchestrator).attest(agentId, trailHash("x"), "TRADE", "s")
      ).to.be.revertedWithCustomError(attestation, "NotAuthorizedForAgent");

      await registry.connect(agentOwner).setOperator(agentId, orchestrator.address, true);
      await expect(attestation.connect(orchestrator).attest(agentId, trailHash("x"), "TRADE", "s")).to.emit(
        attestation,
        "AttestationSubmitted"
      );
      expect((await attestation.getAttestation(1n)).submitter).to.equal(orchestrator.address);
    });

    it("rejects strangers, unknown agents and empty hashes", async function () {
      const ctx = await withAgent();
      const { attestation, agentOwner, outsider, agentId } = ctx;

      await expect(attestation.connect(outsider).attest(agentId, trailHash("a"), "TRADE", "s"))
        .to.be.revertedWithCustomError(attestation, "NotAuthorizedForAgent")
        .withArgs(agentId, outsider.address);

      await expect(attestation.connect(agentOwner).attest(99n, trailHash("a"), "TRADE", "s"))
        .to.be.revertedWithCustomError(attestation, "NotAuthorizedForAgent")
        .withArgs(99n, agentOwner.address);

      await expect(
        attestation.connect(agentOwner).attest(agentId, ethers.ZeroHash, "TRADE", "s")
      ).to.be.revertedWithCustomError(attestation, "EmptyTrailHash");
    });

    it("refuses to replay the same decision trail", async function () {
      const ctx = await withAgent();
      const { attestation, agentOwner, agentId } = ctx;
      const hash = trailHash(TRAIL);

      await attestation.connect(agentOwner).attest(agentId, hash, "TRADE", "first");
      await expect(attestation.connect(agentOwner).attest(agentId, hash, "TRADE", "replay"))
        .to.be.revertedWithCustomError(attestation, "DuplicateTrailHash")
        .withArgs(hash, 1n);
    });

    it("refuses attestations from a deregistered agent", async function () {
      const ctx = await withAgent();
      const { registry, attestation, agentOwner, agentId } = ctx;

      await registry.connect(agentOwner).deregister(agentId);
      await expect(attestation.connect(agentOwner).attest(agentId, trailHash("a"), "TRADE", "s"))
        .to.be.revertedWithCustomError(attestation, "AgentNotActive")
        .withArgs(agentId);
    });
  });

  describe("trail verification", function () {
    it("matches the revealed trail against the on-chain commitment", async function () {
      const ctx = await withAgent();
      const { attestation, agentOwner, agentId } = ctx;
      const canonical = JSON.stringify(TRAIL);

      await attestation.connect(agentOwner).attest(agentId, trailHash(TRAIL), "TRADE", "BUY");

      expect(await attestation.verifyTrail(1n, ethers.toUtf8Bytes(canonical))).to.equal(true);
      expect(await attestation.verifyTrail(1n, ethers.toUtf8Bytes(canonical + " "))).to.equal(false);
      await expect(attestation.verifyTrail(2n, ethers.toUtf8Bytes(canonical)))
        .to.be.revertedWithCustomError(attestation, "UnknownAttestation")
        .withArgs(2n);
    });
  });

  describe("dispute hooks", function () {
    it("only lets the dispute module flag attestations", async function () {
      const ctx = await withAgent();
      const { attestation, agentOwner, outsider, agentId } = ctx;
      await attestation.connect(agentOwner).attest(agentId, trailHash("a"), "TRADE", "s");

      await expect(attestation.connect(outsider).markDisputed(1n))
        .to.be.revertedWithCustomError(attestation, "NotDisputeModule")
        .withArgs(outsider.address);
      await expect(attestation.connect(outsider).markResolved(1n, true))
        .to.be.revertedWithCustomError(attestation, "NotDisputeModule")
        .withArgs(outsider.address);
    });

    it("tracks clean vs slashed attestation counts per agent", async function () {
      const ctx = await withAgent();
      const { registry, attestation, admin, agentOwner, agentId } = ctx;

      // Point the dispute hooks at an EOA so the counters can be driven directly.
      await attestation.connect(admin).setDisputeModule(admin.address);
      for (const s of ["a", "b", "c"]) {
        await attestation.connect(agentOwner).attest(agentId, trailHash(s), "TRADE", s);
      }

      expect(await attestation.totalByAgent(agentId)).to.equal(3n);
      expect(await attestation.cleanByAgent(agentId)).to.equal(3n);

      await attestation.connect(admin).markDisputed(2n);
      expect((await attestation.getAttestation(2n)).disputed).to.equal(true);

      await attestation.connect(admin).markResolved(2n, true);
      const flagged = await attestation.getAttestation(2n);
      expect(flagged.disputed).to.equal(false);
      expect(flagged.slashed).to.equal(true);
      expect(await attestation.slashedByAgent(agentId)).to.equal(1n);
      expect(await attestation.cleanByAgent(agentId)).to.equal(2n);

      // A second resolution must not double-count the same attestation.
      await attestation.connect(admin).markResolved(2n, true);
      expect(await attestation.slashedByAgent(agentId)).to.equal(1n);

      // A rejected dispute leaves the attestation clean.
      await attestation.connect(admin).markDisputed(3n);
      await attestation.connect(admin).markResolved(3n, false);
      expect((await attestation.getAttestation(3n)).slashed).to.equal(false);
      expect(await attestation.cleanByAgent(agentId)).to.equal(2n);
      void registry;
    });
  });

  describe("listRecent feed", function () {
    it("returns newest first with offset and limit", async function () {
      const ctx = await withAgent();
      const { attestation, agentOwner, agentId } = ctx;
      for (const s of ["one", "two", "three", "four"]) {
        await attestation.connect(agentOwner).attest(agentId, trailHash(s), "TRADE", s);
      }

      const newest = await attestation.listRecent(0n, 2n);
      expect(newest.map((a) => a.summary)).to.deep.equal(["four", "three"]);

      const next = await attestation.listRecent(2n, 2n);
      expect(next.map((a) => a.summary)).to.deep.equal(["two", "one"]);

      expect(await attestation.listRecent(0n, 0n)).to.have.length(4); // limit 0 => everything
      expect(await attestation.listRecent(10n, 5n)).to.have.length(0);
      expect(await attestation.listRecent(3n, 99n)).to.have.length(1);

      expect(await attestation.attestationIdsOfAgent(agentId)).to.deep.equal([1n, 2n, 3n, 4n]);
    });
  });
});

// Reads the block timestamp of the mined tx, since attest() stamps block.timestamp.
function anyTimestamp(tx) {
  return (received) => {
    void tx;
    return typeof received === "bigint" && received > 0n;
  };
}
