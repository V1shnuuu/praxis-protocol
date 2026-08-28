const { ethers } = require("hardhat");

const E18 = 10n ** 18n;

/** Reads deployment parameters from the environment, falling back to demo-friendly defaults. */
function readParams(deployerAddress) {
  const whole = (name, fallback) => BigInt(process.env[name] || fallback) * E18;
  const num = (name, fallback) => BigInt(process.env[name] || fallback);
  const addr = (name) => {
    const value = process.env[name];
    if (!value) return deployerAddress;
    if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
    return ethers.getAddress(value);
  };

  return {
    initialSupply: whole("INITIAL_SUPPLY", "10000000"),
    minBond: whole("MIN_BOND", "1000"),
    challengeWindow: num("CHALLENGE_WINDOW_SECONDS", "300"),
    challengeFee: whole("CHALLENGE_FEE", "100"),
    slashBps: num("SLASH_BPS", "2000"),
    challengerRewardBps: num("CHALLENGER_REWARD_BPS", "5000"),
    arbiter: addr("ARBITER_ADDRESS"),
    treasury: addr("TREASURY_ADDRESS"),
  };
}

module.exports = { readParams, E18 };
