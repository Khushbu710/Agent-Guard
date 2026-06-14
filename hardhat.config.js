require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// ─────────────────────────────────────────────────────────────────────────────
// Environment variable helpers
// All sensitive values are read exclusively from .env — never hardcoded.
// ─────────────────────────────────────────────────────────────────────────────
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const ARBITRUM_SEPOLIA_RPC_URL =
  process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY || "";

// Guard: warn loudly at startup if deploying without a key configured.
if (!DEPLOYER_PRIVATE_KEY && process.env.HARDHAT_NETWORK === "arbitrumSepolia") {
  console.warn(
    "\n⚠️  WARNING: DEPLOYER_PRIVATE_KEY is not set in .env.\n" +
      "    Deployment to Arbitrum Sepolia will fail.\n"
  );
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // ── Solidity ───────────────────────────────────────────────────────────────
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        // 200 runs: balanced between deployment cost and call cost.
        // Appropriate for a protocol where functions are called regularly.
        runs: 200,
      },
      // Enable the new IR-based code generator for better optimisation on
      // Arbitrum's ArbOS execution environment.
      viaIR: false,
    },
  },

  // ── Networks ───────────────────────────────────────────────────────────────
  networks: {
    // Local Hardhat network — used by `npx hardhat test` and `npx hardhat node`.
    hardhat: {
      chainId: 31337,
      // Fund test accounts generously for treasury deposit tests.
      accounts: {
        count: 10,
        accountsBalance: "10000000000000000000000", // 10,000 ETH each
      },
    },

    // Local node started with `npx hardhat node` — useful for manual testing
    // via scripts without redeploying each time.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // Arbitrum Sepolia — primary deployment target.
    // Chain ID: 421614
    // Native currency: ETH (bridged from Ethereum Sepolia)
    arbitrumSepolia: {
      url: ARBITRUM_SEPOLIA_RPC_URL,
      chainId: 421614,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      // Arbitrum has very low gas prices relative to L1.
      // gasPrice: "auto" works correctly on Arbitrum Sepolia.
      gasPrice: "auto",
    },
  },

  // ── Contract Verification ──────────────────────────────────────────────────
  // Arbitrum Sepolia uses the Arbiscan explorer.
  // Get an API key at https://arbiscan.io/
  etherscan: {
    apiKey: {
      arbitrumSepolia: ARBISCAN_API_KEY,
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },

  // ── Gas Reporter ──────────────────────────────────────────────────────────
  // Activated when REPORT_GAS=true is set in .env.
  // Useful during development to track function cost before deploying.
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.CI ? "gas-report.txt" : undefined,
    noColors: !!process.env.CI,
  },

  // ── Paths ─────────────────────────────────────────────────────────────────
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  // ── Mocha (test runner) ───────────────────────────────────────────────────
  mocha: {
    // Generous timeout for Hardhat Network — some credential upgrade sequences
    // involve many transactions in a single test.
    timeout: 60000,
  },
};