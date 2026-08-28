const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployPraxisFixture, registerAgent, trailHash, E18 } = require("./helpers/fixture");

const BOND = 10_000n * E18;

describe("DisputeSlashing", function () {
  async function withAttestation() {
    const ctx = await loadFixture(deployPraxisFixture);
    const agentId = await registerAgent(ctx, ctx.agentOwner, "TradingAgent", "ipfs://policy-1", BOND);
    await ctx.attestation
      .connect(ctx.agentOwner)
      .attest(agentId, trailHash("rogue-trade"), "TRADE", "BUY 9.9 ETH (85% of book)");
    return { ...ctx, agentId, attestationId: 1n };
  }

  describe("opening a dispute", function () {
    it("stakes the fee, locks the bond at risk and flags the attestation", async function () {
      const ctx = await withAttestation();
      const { dispute, registry, attestation, token, challenger, agentId, attestationId, params } = ctx;

      const feeBefore = await token.balanceOf(challenger.address);
      await expect(dispute.connect(challenger).openDispute(attestationId, "Exceeded 20% position cap"))
        .to.emit(dispute, "DisputeOpened")
        .withArgs(
          1n,
          attestationId,
          agentId,
          challenger.address,
          params.challengeFee,
          "Exceeded 20% position cap",
          (t) => typeof t === "bigint" && t > 0n
        );

      expect(await token.balanceOf(challenger.address)).to.equal(feeBefore - params.challengeFee);

      const d = await dispute.getDispute(1n);
      expect(d.id).to.equal(1n);
      expect(d.attestationId).to.equal(attestationId);
      expect(d.agentId).to.equal(agentId);
      expect(d.challenger).to.equal(challenger.address);
      expect(d.fee).to.equal(params.challengeFee);
      expect(d.status).to.equal(1n); // Open
      expect(d.bondBefore).to.equal(BOND);
      expect(d.lockedAmount).to.equal((BOND * params.slashBps) / 10_000n);

      expect((await registry.getAgent(agentId)).lockedBond).to.equal(2_000n * E18);
      expect((await attestation.getAttestation(attestationId)).disputed).to.equal(true);
      expect(await dispute.openDisputesByAgent(agentId)).to.equal(1n);
      expect(await dispute.openDisputeOf(attestationId)).to.equal(1n);
    });

    it("refuses a second open dispute against the same attestation", async function () {
      const ctx = await withAttestation();
      const { dispute, challenger, outsider, attestationId } = ctx;

      await dispute.connect(challenger).openDispute(attestationId, "first");
      await expect(dispute.connect(outsider).openDispute(attestationId, "second"))
        .to.be.revertedWithCustomError(dispute, "DisputeAlreadyOpen")
        .withArgs(attestationId, 1n);
    });

    it("refuses a dispute against an unknown attestation", async function () {
      const ctx = await withAttestation();
      await expect(ctx.dispute.connect(ctx.challenger).openDispute(99n, "nope"))
        .to.be.revertedWithCustomError(ctx.dispute, "UnknownAttestation")
        .withArgs(99n);
    });

    it("closes the challenge window after the configured period", async function () {
      const ctx = await withAttestation();
      const { dispute, attestation, challenger, attestationId, params } = ctx;

      expect(await dispute.isChallengeable(attestationId)).to.equal(true);
      const deadline = (await attestation.timestampOf(attestationId)) + params.challengeWindow;

      await time.increaseTo(deadline + 1n);
      expect(await dispute.isChallengeable(attestationId)).to.equal(false);
      await expect(dispute.connect(challenger).openDispute(attestationId, "too late"))
        .to.be.revertedWithCustomError(dispute, "ChallengeWindowClosed")
        .withArgs(attestationId, deadline);
    });

    it("stops an agent challenging its own attestation", async function () {
      const ctx = await withAttestation();
      const { dispute, agentOwner, agentId, attestationId } = ctx;

      await expect(dispute.connect(agentOwner).openDispute(attestationId, "self"))
        .to.be.revertedWithCustomError(dispute, "AgentCannotChallengeSelf")
        .withArgs(agentId);
    });

    it("prevents the agent withdrawing the bond that is under dispute", async function () {
      const ctx = await withAttestation();
      const { dispute, registry, agentOwner, challenger, agentId, attestationId } = ctx;

      await dispute.connect(challenger).openDispute(attestationId, "violation");

      const free = BOND - 2_000n * E18;
      await expect(registry.connect(agentOwner).withdrawBond(agentId, free + 1n))
        .to.be.revertedWithCustomError(registry, "InsufficientFreeBond")
        .withArgs(free + 1n, free);
      // The unreserved remainder is still withdrawable.
      await registry.connect(agentOwner).withdrawBond(agentId, 1_000n * E18);
    });
  });

  describe("resolving upheld", function () {
    it("slashes the bond, pays the challenger and sends the rest to the treasury", async function () {
      const ctx = await withAttestation();
      const { dispute, registry, attestation, token, admin, challenger, treasury, agentId, attestationId } =
        ctx;

      await dispute.connect(challenger).openDispute(attestationId, "Exceeded 20% position cap");

      const slashed = 2_000n * E18; // 20% of 10 000
      const reward = 1_000n * E18; // 50% of the slash
      const payout = reward + 100n * E18; // + the returned challenge fee
      const toTreasury = slashed - reward;

      const challengerBefore = await token.balanceOf(challenger.address);
      const treasuryBefore = await token.balanceOf(treasury.address);

      await expect(dispute.connect(admin).resolve(1n, true))
        .to.emit(dispute, "DisputeResolved")
        .withArgs(1n, attestationId, agentId, true, slashed, payout, BOND, BOND - slashed)
        .and.to.emit(registry, "AgentSlashed")
        .withArgs(agentId, slashed, 2_000n, BOND - slashed);

      expect(await token.balanceOf(challenger.address)).to.equal(challengerBefore + payout);
      expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore + toTreasury);

      const agent = await registry.getAgent(agentId);
      expect(agent.bond).to.equal(BOND - slashed);
      expect(agent.lockedBond).to.equal(0n);
      expect(agent.totalSlashed).to.equal(slashed);
      expect(agent.slashCount).to.equal(1n);

      const a = await attestation.getAttestation(attestationId);
      expect(a.disputed).to.equal(false);
      expect(a.slashed).to.equal(true);

      const d = await dispute.getDispute(1n);
      expect(d.status).to.equal(2n); // Upheld
      expect(d.slashedAmount).to.equal(slashed);
      expect(d.challengerPayout).to.equal(payout);
      expect(d.bondBefore).to.equal(BOND);
      expect(d.bondAfter).to.equal(BOND - slashed);
      expect(d.resolvedAt).to.be.greaterThan(0n);

      expect(await dispute.openDisputesByAgent(agentId)).to.equal(0n);
      expect(await dispute.upheldDisputesByAgent(agentId)).to.equal(1n);
      expect(await dispute.openDisputeOf(attestationId)).to.equal(0n);
    });

    it("leaves no tokens stranded in the dispute contract", async function () {
      const ctx = await withAttestation();
      const { dispute, token, admin, challenger, attestationId } = ctx;

      await dispute.connect(challenger).openDispute(attestationId, "violation");
      await dispute.connect(admin).resolve(1n, true);

      expect(await token.balanceOf(await dispute.getAddress())).to.equal(0n);
    });

    it("deactivates an agent slashed below the minimum bond", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, attestation, dispute, admin, agentOwner, challenger, params } = ctx;

      // Bond just above the minimum: a single 20% slash drops it under.
      const thin = params.minBond + 1n;
      const agentId = await registerAgent(ctx, agentOwner, "Thin", "uri", thin);
      await attestation.connect(agentOwner).attest(agentId, trailHash("bad"), "TRADE", "bad");
      await dispute.connect(challenger).openDispute(1n, "violation");
      await dispute.connect(admin).resolve(1n, true);

      expect(await registry.isActive(agentId)).to.equal(false);
      await expect(attestation.connect(agentOwner).attest(agentId, trailHash("next"), "TRADE", "s"))
        .to.be.revertedWithCustomError(attestation, "AgentNotActive")
        .withArgs(agentId);
    });
  });

  describe("resolving rejected", function () {
    it("forfeits the challenger's fee into the agent's bond", async function () {
      const ctx = await withAttestation();
      const { dispute, registry, attestation, token, admin, challenger, agentId, attestationId, params } =
        ctx;

      await dispute.connect(challenger).openDispute(attestationId, "unfounded");
      const challengerBefore = await token.balanceOf(challenger.address);

      await expect(dispute.connect(admin).resolve(1n, false))
        .to.emit(dispute, "DisputeResolved")
        .withArgs(1n, attestationId, agentId, false, 0n, 0n, BOND, BOND + params.challengeFee);

      expect(await token.balanceOf(challenger.address)).to.equal(challengerBefore); // fee not returned
      expect(await token.balanceOf(await dispute.getAddress())).to.equal(0n);

      const agent = await registry.getAgent(agentId);
      expect(agent.bond).to.equal(BOND + params.challengeFee);
      expect(agent.lockedBond).to.equal(0n);
      expect(agent.slashCount).to.equal(0n);
      expect(agent.active).to.equal(true);

      const a = await attestation.getAttestation(attestationId);
      expect(a.disputed).to.equal(false);
      expect(a.slashed).to.equal(false);

      expect(await dispute.rejectedDisputesByAgent(agentId)).to.equal(1n);
      expect(await dispute.openDisputesByAgent(agentId)).to.equal(0n);
    });

    it("reopens the attestation to a fresh challenge while the window is open", async function () {
      const ctx = await withAttestation();
      const { dispute, admin, challenger, outsider, attestationId } = ctx;

      await dispute.connect(challenger).openDispute(attestationId, "first");
      await dispute.connect(admin).resolve(1n, false);
      await expect(dispute.connect(outsider).openDispute(attestationId, "second")).to.emit(
        dispute,
        "DisputeOpened"
      );
      expect(await dispute.disputeCount()).to.equal(2n);
    });
  });

  describe("resolution access control", function () {
    it("only lets the arbiter resolve", async function () {
      const ctx = await withAttestation();
      const { dispute, challenger, outsider, attestationId } = ctx;

      await dispute.connect(challenger).openDispute(attestationId, "violation");
      await expect(dispute.connect(outsider).resolve(1n, true))
        .to.be.revertedWithCustomError(dispute, "NotArbiter")
        .withArgs(outsider.address);
    });

    it("rejects unknown and already-resolved disputes", async function () {
      const ctx = await withAttestation();
      const { dispute, admin, challenger, attestationId } = ctx;

      await expect(dispute.connect(admin).resolve(1n, true))
        .to.be.revertedWithCustomError(dispute, "UnknownDispute")
        .withArgs(1n);

      await dispute.connect(challenger).openDispute(attestationId, "violation");
      await dispute.connect(admin).resolve(1n, true);
      await expect(dispute.connect(admin).resolve(1n, true))
        .to.be.revertedWithCustomError(dispute, "DisputeNotOpen")
        .withArgs(1n);
    });

    it("lets the owner rotate the arbiter, treasury and parameters", async function () {
      const ctx = await withAttestation();
      const { dispute, admin, outsider, treasury } = ctx;

      await expect(dispute.connect(outsider).setArbiter(outsider.address)).to.be.revertedWithCustomError(
        dispute,
        "OwnableUnauthorizedAccount"
      );

      await expect(dispute.connect(admin).setArbiter(outsider.address))
        .to.emit(dispute, "ArbiterUpdated")
        .withArgs(admin.address, outsider.address);
      expect(await dispute.arbiter()).to.equal(outsider.address);

      await expect(dispute.connect(admin).setTreasury(admin.address))
        .to.emit(dispute, "TreasuryUpdated")
        .withArgs(treasury.address, admin.address);

      await expect(dispute.connect(admin).setParameters(60n, 5n, 3_000n, 2_500n))
        .to.emit(dispute, "ParametersUpdated")
        .withArgs(60n, 5n, 3_000n, 2_500n);
      expect(await dispute.challengeWindow()).to.equal(60n);
      expect(await dispute.slashBps()).to.equal(3_000n);

      await expect(dispute.connect(admin).setParameters(60n, 5n, 0n, 2_500n))
        .to.be.revertedWithCustomError(dispute, "InvalidBps")
        .withArgs(0n);
      await expect(dispute.connect(admin).setParameters(60n, 5n, 10_001n, 2_500n))
        .to.be.revertedWithCustomError(dispute, "InvalidBps")
        .withArgs(10_001n);
    });
  });

  describe("concurrent disputes", function () {
    it("tracks two disputes against different attestations independently", async function () {
      const ctx = await withAttestation();
      const { dispute, registry, attestation, admin, agentOwner, challenger, outsider, agentId } = ctx;

      await attestation.connect(agentOwner).attest(agentId, trailHash("second"), "TRADE", "SELL 1 ETH");

      await dispute.connect(challenger).openDispute(1n, "first violation");
      await dispute.connect(outsider).openDispute(2n, "second violation");
      expect(await dispute.openDisputesByAgent(agentId)).to.equal(2n);

      // 20% of 10 000 reserved twice.
      expect((await registry.getAgent(agentId)).lockedBond).to.equal(4_000n * E18);

      await dispute.connect(admin).resolve(1n, true); // bond 10 000 -> 8 000
      expect(await dispute.openDisputesByAgent(agentId)).to.equal(1n);

      await dispute.connect(admin).resolve(2n, true); // 20% of 8 000 -> 6 400
      const agent = await registry.getAgent(agentId);
      expect(agent.bond).to.equal(6_400n * E18);
      expect(agent.lockedBond).to.equal(0n);
      expect(agent.slashCount).to.equal(2n);
      expect(await dispute.openDisputesByAgent(agentId)).to.equal(0n);
      expect(await dispute.upheldDisputesByAgent(agentId)).to.equal(2n);
    });
  });

  describe("listRecent", function () {
    it("returns newest disputes first", async function () {
      const ctx = await withAttestation();
      const { dispute, attestation, agentOwner, challenger, outsider, agentId } = ctx;

      await attestation.connect(agentOwner).attest(agentId, trailHash("second"), "TRADE", "s2");
      await dispute.connect(challenger).openDispute(1n, "reason-1");
      await dispute.connect(outsider).openDispute(2n, "reason-2");

      const page = await dispute.listRecent(0n, 10n);
      expect(page.map((d) => d.reason)).to.deep.equal(["reason-2", "reason-1"]);
      expect(page.map((d) => d.id)).to.deep.equal([2n, 1n]);
      expect(await dispute.listRecent(1n, 5n)).to.have.length(1);
      expect(await dispute.listRecent(5n, 5n)).to.have.length(0);
      expect(await dispute.disputeIdsOfAgent(agentId)).to.deep.equal([1n, 2n]);
    });
  });

  describe("constructor validation", function () {
    it("rejects zero addresses and out-of-range bps", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, attestation, token, admin, treasury } = ctx;
      const base = [
        await registry.getAddress(),
        await attestation.getAddress(),
        await token.getAddress(),
        admin.address,
        treasury.address,
        300n,
        0n,
        2_000n,
        5_000n,
        admin.address,
      ];

      const Dispute = await ethers.getContractFactory("DisputeSlashing");

      const zeroed = [...base];
      zeroed[0] = ethers.ZeroAddress;
      await expect(Dispute.deploy(...zeroed)).to.be.revertedWithCustomError(Dispute, "ZeroAddress");

      const badBps = [...base];
      badBps[7] = 10_001n;
      await expect(Dispute.deploy(...badBps)).to.be.revertedWithCustomError(Dispute, "InvalidBps");
    });
  });
});
