const { ethers } = require("hardhat");

/**
 * Deploys the five Praxis contracts and wires the cross-contract permissions.
 * Shared by scripts/deploy.js and scripts/demo-flow.js so both exercise identical wiring.
 */
async function deployPraxis(deployer, params, log = () => {}) {
  const token = await ethers.deployContract("PraxisToken", [deployer.address, params.initialSupply], deployer);
  await token.waitForDeployment();
  log(`PraxisToken       ${await token.getAddress()}`);

  const registry = await ethers.deployContract(
    "AgentRegistry",
    [await token.getAddress(), params.minBond, deployer.address],
    deployer
  );
  await registry.waitForDeployment();
  log(`AgentRegistry     ${await registry.getAddress()}`);

  const attestation = await ethers.deployContract(
    "ActionAttestation",
    [await registry.getAddress(), deployer.address],
    deployer
  );
  await attestation.waitForDeployment();
  log(`ActionAttestation ${await attestation.getAddress()}`);

  const dispute = await ethers.deployContract(
    "DisputeSlashing",
    [
      await registry.getAddress(),
      await attestation.getAddress(),
      await token.getAddress(),
      params.arbiter,
      params.treasury,
      params.challengeWindow,
      params.challengeFee,
      params.slashBps,
      params.challengerRewardBps,
      deployer.address,
    ],
    deployer
  );
  await dispute.waitForDeployment();
  log(`DisputeSlashing   ${await dispute.getAddress()}`);

  const reputation = await ethers.deployContract(
    "ReputationScore",
    [
      await registry.getAddress(),
      await attestation.getAddress(),
      await dispute.getAddress(),
      deployer.address,
    ],
    deployer
  );
  await reputation.waitForDeployment();
  log(`ReputationScore   ${await reputation.getAddress()}`);

  await (await registry.connect(deployer).setSlasher(await dispute.getAddress())).wait();
  await (await attestation.connect(deployer).setDisputeModule(await dispute.getAddress())).wait();
  log("permissions wired: DisputeSlashing is the registry slasher and the attestation dispute module");

  return { token, registry, attestation, dispute, reputation };
}

module.exports = { deployPraxis };
