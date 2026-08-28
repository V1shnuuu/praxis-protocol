const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployPraxisFixture, registerAgent, E18 } = require("./helpers/fixture");

describe("AgentRegistry", function () {
  describe("registration", function () {
    it("registers an agent, escrows the bond and stores its profile", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, token, agentOwner, params } = ctx;

      const before = await token.balanceOf(agentOwner.address);
      await expect(registry.connect(agentOwner).register("TradingAgent", "ipfs://policy-1", params.minBond))
        .to.emit(registry, "AgentRegistered")
        .withArgs(1n, agentOwner.address, "TradingAgent", "ipfs://policy-1", params.minBond);

      const agent = await registry.getAgent(1n);
      expect(agent.id).to.equal(1n);
      expect(agent.owner).to.equal(agentOwner.address);
      expect(agent.name).to.equal("TradingAgent");
      expect(agent.metadataURI).to.equal("ipfs://policy-1");
      expect(agent.bond).to.equal(params.minBond);
      expect(agent.lockedBond).to.equal(0n);
      expect(agent.slashCount).to.equal(0n);
      expect(agent.active).to.equal(true);
      expect(agent.registeredAt).to.be.greaterThan(0n);

      expect(await token.balanceOf(agentOwner.address)).to.equal(before - params.minBond);
      expect(await token.balanceOf(await registry.getAddress())).to.equal(params.minBond);
      expect(await registry.agentCount()).to.equal(1n);
    });

    it("assigns sequential ids and indexes agents by owner", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, otherAgentOwner, params } = ctx;

      await registry.connect(agentOwner).register("A", "uri-a", params.minBond);
      await registry.connect(otherAgentOwner).register("B", "uri-b", params.minBond);
      await registry.connect(agentOwner).register("C", "uri-c", params.minBond);

      expect(await registry.agentCount()).to.equal(3n);
      expect(await registry.agentsOfOwner(agentOwner.address)).to.deep.equal([1n, 3n]);
      expect(await registry.agentsOfOwner(otherAgentOwner.address)).to.deep.equal([2n]);
    });

    it("rejects a bond below the minimum", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, params } = ctx;

      const tooSmall = params.minBond - 1n;
      await expect(registry.connect(agentOwner).register("Cheap", "uri", tooSmall))
        .to.be.revertedWithCustomError(registry, "BondBelowMinimum")
        .withArgs(tooSmall, params.minBond);
    });

    it("rejects an empty name", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, params } = ctx;
      await expect(
        registry.connect(agentOwner).register("", "uri", params.minBond)
      ).to.be.revertedWithCustomError(registry, "EmptyName");
    });

    it("reverts when the caller has not approved enough tokens", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, token, orchestrator, params } = ctx;
      await token.connect(ctx.admin).transfer(orchestrator.address, params.minBond);

      await expect(
        registry.connect(orchestrator).register("NoApproval", "uri", params.minBond)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("reports unknown agents rather than returning empty data", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      await expect(ctx.registry.getAgent(1n))
        .to.be.revertedWithCustomError(ctx.registry, "UnknownAgent")
        .withArgs(1n);
      expect(await ctx.registry.exists(1n)).to.equal(false);
      expect(await ctx.registry.isActive(1n)).to.equal(false);
    });
  });

  describe("authorization", function () {
    it("treats the owner as authorized and strangers as not", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const id = await registerAgent(ctx, ctx.agentOwner, "A", "uri");

      expect(await ctx.registry.isAuthorized(id, ctx.agentOwner.address)).to.equal(true);
      expect(await ctx.registry.isAuthorized(id, ctx.outsider.address)).to.equal(false);
      expect(await ctx.registry.isAuthorized(999n, ctx.agentOwner.address)).to.equal(false);
    });

    it("lets the owner add and revoke an orchestrator operator", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, orchestrator } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri");

      await expect(registry.connect(agentOwner).setOperator(id, orchestrator.address, true))
        .to.emit(registry, "OperatorSet")
        .withArgs(id, orchestrator.address, true);
      expect(await registry.isAuthorized(id, orchestrator.address)).to.equal(true);

      await registry.connect(agentOwner).setOperator(id, orchestrator.address, false);
      expect(await registry.isAuthorized(id, orchestrator.address)).to.equal(false);
    });

    it("blocks non-owners from mutating an agent", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, outsider, orchestrator } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri");

      await expect(registry.connect(outsider).setOperator(id, orchestrator.address, true))
        .to.be.revertedWithCustomError(registry, "NotAgentOwner")
        .withArgs(id, outsider.address);
      await expect(registry.connect(outsider).updateMetadata(id, "hacked"))
        .to.be.revertedWithCustomError(registry, "NotAgentOwner")
        .withArgs(id, outsider.address);
      await expect(registry.connect(outsider).withdrawBond(id, 1n))
        .to.be.revertedWithCustomError(registry, "NotAgentOwner")
        .withArgs(id, outsider.address);
    });

    it("lets the owner update the metadata URI", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const id = await registerAgent(ctx, ctx.agentOwner, "A", "uri-v1");

      await expect(ctx.registry.connect(ctx.agentOwner).updateMetadata(id, "uri-v2"))
        .to.emit(ctx.registry, "MetadataUpdated")
        .withArgs(id, "uri-v2");
      expect((await ctx.registry.getAgent(id)).metadataURI).to.equal("uri-v2");
    });
  });

  describe("bonding", function () {
    it("accepts top-ups from anyone", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, outsider, params } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri");

      const top = 500n * E18;
      await expect(registry.connect(outsider).topUpBond(id, top))
        .to.emit(registry, "BondIncreased")
        .withArgs(id, outsider.address, top, params.minBond + top);
      expect(await registry.bondOf(id)).to.equal(params.minBond + top);
    });

    it("allows withdrawing free bond down to the minimum", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, token, agentOwner, params } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", params.minBond * 3n);

      const before = await token.balanceOf(agentOwner.address);
      await expect(registry.connect(agentOwner).withdrawBond(id, params.minBond * 2n))
        .to.emit(registry, "BondWithdrawn")
        .withArgs(id, agentOwner.address, params.minBond * 2n, params.minBond);

      expect(await token.balanceOf(agentOwner.address)).to.equal(before + params.minBond * 2n);
      expect(await registry.bondOf(id)).to.equal(params.minBond);
    });

    it("refuses a withdrawal that would drop the bond under the minimum", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, params } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", params.minBond * 2n);

      await expect(registry.connect(agentOwner).withdrawBond(id, params.minBond + 1n))
        .to.be.revertedWithCustomError(registry, "BondBelowMinimum")
        .withArgs(params.minBond - 1n, params.minBond);
    });

    it("deregisters an agent and refunds the whole bond", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, token, agentOwner, params } = ctx;
      const bond = params.minBond * 2n;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", bond);

      const before = await token.balanceOf(agentOwner.address);
      await expect(registry.connect(agentOwner).deregister(id))
        .to.emit(registry, "AgentDeregistered")
        .withArgs(id, agentOwner.address, bond);

      expect(await token.balanceOf(agentOwner.address)).to.equal(before + bond);
      expect(await registry.isActive(id)).to.equal(false);
      await expect(registry.connect(agentOwner).deregister(id))
        .to.be.revertedWithCustomError(registry, "AgentInactive")
        .withArgs(id);
    });
  });

  describe("slashing access control", function () {
    it("only lets the configured slasher lock, unlock, credit and slash", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner, outsider } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri");

      const calls = [
        () => registry.connect(outsider).slash(id, 1000n),
        () => registry.connect(outsider).lockBond(id, 1n),
        () => registry.connect(outsider).unlockBond(id, 1n),
        () => registry.connect(outsider).creditBond(id, 1n),
      ];
      for (const call of calls) {
        await expect(call())
          .to.be.revertedWithCustomError(registry, "NotSlasher")
          .withArgs(outsider.address);
      }
    });

    it("only lets the owner rotate the slasher and minimum bond", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, admin, outsider } = ctx;

      await expect(registry.connect(outsider).setSlasher(outsider.address)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount"
      );
      await expect(registry.connect(admin).setMinBond(1n))
        .to.emit(registry, "MinBondUpdated")
        .withArgs(ctx.params.minBond, 1n);
      expect(await registry.minBond()).to.equal(1n);
    });
  });

  describe("slashing math", function () {
    // Drive slash() directly through a signer wired in as the slasher, so the
    // arithmetic is tested independently of the dispute flow.
    async function withDirectSlasher() {
      const ctx = await loadFixture(deployPraxisFixture);
      await ctx.registry.connect(ctx.admin).setSlasher(ctx.admin.address);
      return ctx;
    }

    it("burns exactly bps of the remaining bond and pays the slasher", async function () {
      const ctx = await withDirectSlasher();
      const { registry, token, admin, agentOwner, params } = ctx;
      const bond = 10_000n * E18;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", bond);

      const expected = (bond * 2_000n) / 10_000n; // 2000 bps = 20%
      const slasherBefore = await token.balanceOf(admin.address);

      await expect(registry.connect(admin).slash(id, 2_000n))
        .to.emit(registry, "AgentSlashed")
        .withArgs(id, expected, 2_000n, bond - expected);

      expect(await registry.bondOf(id)).to.equal(bond - expected);
      expect(await token.balanceOf(admin.address)).to.equal(slasherBefore + expected);

      const agent = await registry.getAgent(id);
      expect(agent.totalSlashed).to.equal(expected);
      expect(agent.slashCount).to.equal(1n);
      expect(agent.active).to.equal(true); // 8000 PRAX still above the 1000 minimum
      void params;
    });

    it("compounds successive slashes against the shrinking bond", async function () {
      const ctx = await withDirectSlasher();
      const { registry, admin, agentOwner } = ctx;
      const bond = 10_000n * E18;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", bond);

      await registry.connect(admin).slash(id, 2_000n); // -2000 => 8000
      await registry.connect(admin).slash(id, 2_000n); // -1600 => 6400

      expect(await registry.bondOf(id)).to.equal(6_400n * E18);
      const agent = await registry.getAgent(id);
      expect(agent.totalSlashed).to.equal(3_600n * E18);
      expect(agent.slashCount).to.equal(2n);
    });

    it("deactivates an agent whose bond falls under the minimum", async function () {
      const ctx = await withDirectSlasher();
      const { registry, admin, agentOwner, params } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", params.minBond);

      await registry.connect(admin).slash(id, 5_000n); // 1000 -> 500, below the 1000 minimum
      expect(await registry.bondOf(id)).to.equal(params.minBond / 2n);
      expect(await registry.isActive(id)).to.equal(false);
    });

    it("rejects a slash of 0 or more than 100%", async function () {
      const ctx = await withDirectSlasher();
      const { registry, admin, agentOwner } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri");

      await expect(registry.connect(admin).slash(id, 0n))
        .to.be.revertedWithCustomError(registry, "InvalidBps")
        .withArgs(0n);
      await expect(registry.connect(admin).slash(id, 10_001n))
        .to.be.revertedWithCustomError(registry, "InvalidBps")
        .withArgs(10_001n);
    });

    it("clamps the locked reservation when a slash eats into it", async function () {
      const ctx = await withDirectSlasher();
      const { registry, admin, agentOwner } = ctx;
      const bond = 10_000n * E18;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", bond);

      await registry.connect(admin).lockBond(id, bond); // reserve everything
      await registry.connect(admin).slash(id, 2_000n);

      const agent = await registry.getAgent(id);
      expect(agent.bond).to.equal(8_000n * E18);
      expect(agent.lockedBond).to.equal(8_000n * E18);
    });

    it("locks no more than the free bond and unlocks no more than is locked", async function () {
      const ctx = await withDirectSlasher();
      const { registry, admin, agentOwner, params } = ctx;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", params.minBond);

      await expect(registry.connect(admin).lockBond(id, params.minBond * 5n))
        .to.emit(registry, "BondLocked")
        .withArgs(id, params.minBond, params.minBond);

      await expect(registry.connect(admin).unlockBond(id, params.minBond * 5n))
        .to.emit(registry, "BondUnlocked")
        .withArgs(id, params.minBond, 0n);
    });

    it("blocks withdrawal and deregistration of a locked bond", async function () {
      const ctx = await withDirectSlasher();
      const { registry, admin, agentOwner, params } = ctx;
      const bond = params.minBond * 3n;
      const id = await registerAgent(ctx, agentOwner, "A", "uri", bond);

      const locked = params.minBond;
      await registry.connect(admin).lockBond(id, locked);

      const free = bond - locked;
      await expect(registry.connect(agentOwner).withdrawBond(id, free + 1n))
        .to.be.revertedWithCustomError(registry, "InsufficientFreeBond")
        .withArgs(free + 1n, free);
      await expect(registry.connect(agentOwner).deregister(id))
        .to.be.revertedWithCustomError(registry, "BondLockedForDispute")
        .withArgs(id, locked);
    });
  });

  describe("listAgents pagination", function () {
    it("returns the requested page and clamps overruns", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { registry, agentOwner } = ctx;
      for (const name of ["A", "B", "C"]) {
        await registerAgent(ctx, agentOwner, name, `uri-${name}`);
      }

      const all = await registry.listAgents(1n, 10n);
      expect(all.map((a) => a.name)).to.deep.equal(["A", "B", "C"]);

      const page = await registry.listAgents(2n, 1n);
      expect(page).to.have.length(1);
      expect(page[0].name).to.equal("B");

      expect(await registry.listAgents(99n, 5n)).to.have.length(0);
      expect(await registry.listAgents(0n, 0n)).to.have.length(3); // start 0 => 1, limit 0 => all
    });
  });

  describe("PraxisToken faucet", function () {
    it("mints once per cooldown window", async function () {
      const ctx = await loadFixture(deployPraxisFixture);
      const { token, outsider } = ctx;

      const before = await token.balanceOf(outsider.address);
      await expect(token.connect(outsider).faucet()).to.emit(token, "FaucetClaimed");
      expect(await token.balanceOf(outsider.address)).to.equal(before + (await token.FAUCET_AMOUNT()));

      await expect(token.connect(outsider).faucet()).to.be.revertedWithCustomError(
        token,
        "FaucetCooldownActive"
      );

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);
      await expect(token.connect(outsider).faucet()).to.emit(token, "FaucetClaimed");
    });
  });
});
