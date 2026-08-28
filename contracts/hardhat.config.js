require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

const SOLC_VERSION = "0.8.24";

// Compile against the `solc` package pinned in devDependencies instead of
// fetching a binary from binaries.soliditylang.org at build time. This keeps
// builds reproducible and lets the project compile in sandboxed/offline CI.
// If the pinned package is missing or mismatched we fall back to Hardhat's
// normal download path.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (args.solcVersion !== SOLC_VERSION) return runSuper(args);
  try {
    const compilerPath = require.resolve("solc/soljson.js");
    const longVersion = require("solc").version().replace(/^(\d+\.\d+\.\d+\+commit\.[0-9a-f]+).*$/, "$1");
    if (!longVersion.startsWith(SOLC_VERSION)) return runSuper(args);
    return { compilerPath, isSolcJs: true, version: SOLC_VERSION, longVersion };
  } catch (_) {
    return runSuper(args);
  }
});

const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

// Three roles, so the live demo mirrors the real trust model:
//   [0] deployer  — protocol admin, arbiter and treasury
//   [1] agent     — owns the registered agents; the backend orchestrator signs as this key
//   [2] challenger— the watcher that stakes a fee to open disputes
// Only the deployer is required; the others unlock scripts/demo-flow.js.
const accounts = [
  process.env.DEPLOYER_PRIVATE_KEY,
  process.env.AGENT_PRIVATE_KEY,
  process.env.CHALLENGER_PRIVATE_KEY,
].filter((key) => typeof key === "string" && key.length > 0);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: { timeout: 120000 },
};
