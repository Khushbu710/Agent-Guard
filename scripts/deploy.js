// scripts/deploy.js
// ─────────────────────────────────────────────────────────────────────────────
// AgentGuard deployment script — Arbitrum Sepolia
//
// Usage:
//   npx hardhat run scripts/deploy.js --network arbitrumSepolia
//   npx hardhat run scripts/deploy.js --network localhost
//
// What this script does:
//   1. Validates environment configuration
//   2. Deploys AgentGuard
//   3. Waits for sufficient confirmations
//   4. Verifies deployment correctness on-chain
//   5. Prints a deployment summary
//   6. Optionally submits source code to Arbiscan for verification
// ─────────────────────────────────────────────────────────────────────────────

const hre = require("hardhat");
const { ethers, network } = require("hardhat");

// ── Constants ─────────────────────────────────────────────────────────────────

// Number of block confirmations to wait after deployment before verifying.
// 5 is sufficient for Arbitrum Sepolia (block time ~0.25s, finality is fast).
const CONFIRMATION_BLOCKS = 5;

// Minimum ETH balance the deployer must hold to proceed.
// Arbitrum gas is cheap, but we want to catch empty wallets early.
const MIN_DEPLOYER_BALANCE_ETH = "0.005";

// ── Helpers ───────────────────────────────────────────────────────────────────

function separator(char = "─", width = 60) {
  return char.repeat(width);
}

function log(label, value) {
  const padded = label.padEnd(26, " ");
  console.log(`  ${padded} ${value}`);
}

async function validateEnvironment(deployer) {
  console.log("\n" + separator("─"));
  console.log("  Pre-flight checks");
  console.log(separator("─"));

  // Network
  const chainId = (await ethers.provider.getNetwork()).chainId;
  log("Network:", network.name);
  log("Chain ID:", chainId.toString());

  // Deployer wallet
  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEth = ethers.formatEther(balance);
  const minBalance = ethers.parseEther(MIN_DEPLOYER_BALANCE_ETH);

  log("Deployer:", deployer.address);
  log("Balance:", `${balanceEth} ETH`);

  if (balance < minBalance) {
    throw new Error(
      `Deployer balance too low.\n` +
        `  Required: >= ${MIN_DEPLOYER_BALANCE_ETH} ETH\n` +
        `  Current:    ${balanceEth} ETH\n\n` +
        `  Fund your wallet from an Arbitrum Sepolia faucet:\n` +
        `  https://faucet.triangleplatform.com/arbitrum/sepolia`
    );
  }

  console.log("  OK Balance sufficient");

  // Gas price
  const feeData = await ethers.provider.getFeeData();
  if (feeData.gasPrice) {
    log("Gas price:", `${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei`);
  }
}

async function deployContract(deployer) {
  console.log("\n" + separator("─"));
  console.log("  Deploying AgentGuard");
  console.log(separator("─"));

  const AgentGuard = await ethers.getContractFactory("AgentGuard", deployer);

  console.log("  Sending deployment transaction...");
  const agentGuard = await AgentGuard.deploy();

  log("Tx hash:", agentGuard.deploymentTransaction().hash);
  console.log("  Waiting for transaction to be mined...");

  await agentGuard.waitForDeployment();
  const address = await agentGuard.getAddress();
  log("Contract address:", address);

  return { agentGuard, address };
}

async function waitForConfirmations(agentGuard) {
  if (network.name === "localhost" || network.name === "hardhat") {
    // Local network mines instantly — no need to wait.
    return;
  }

  console.log(`\n  Waiting for ${CONFIRMATION_BLOCKS} confirmations...`);
  await agentGuard.deploymentTransaction().wait(CONFIRMATION_BLOCKS);
  console.log(`  OK ${CONFIRMATION_BLOCKS} confirmations received`);
}

async function verifyDeployment(agentGuard, deployer) {
  console.log("\n" + separator("─"));
  console.log("  Verifying deployment");
  console.log(separator("─"));

  const address = await agentGuard.getAddress();

  // 1. Code exists at address
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error("No bytecode found at contract address — deployment failed.");
  }
  console.log("  OK Bytecode present at contract address");

  // 2. Owner is the deployer
  const owner = await agentGuard.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Owner mismatch.\n  Expected: ${deployer.address}\n  Got:      ${owner}`
    );
  }
  console.log("  OK Owner correctly set to deployer");

  // 3. Treasury balance starts at zero
  const treasuryBalance = await ethers.provider.getBalance(address);
  if (treasuryBalance !== 0n) {
    console.warn(
      `  WARNING Unexpected treasury balance: ${ethers.formatEther(treasuryBalance)} ETH`
    );
  } else {
    console.log("  OK Treasury balance is zero (expected)");
  }

  // 4. Agent registry is empty
  const totalAgents = await agentGuard.totalAgents();
  if (totalAgents !== 0n) {
    console.warn(`  WARNING Unexpected agent count: ${totalAgents}`);
  } else {
    console.log("  OK Agent registry is empty (expected)");
  }

  // 5. Constants sanity check — spend limits must be strictly ascending
  const bronzeLimit = await agentGuard.BRONZE_SPEND_LIMIT();
  const silverLimit = await agentGuard.SILVER_SPEND_LIMIT();
  const goldLimit = await agentGuard.GOLD_SPEND_LIMIT();

  if (bronzeLimit >= silverLimit || silverLimit >= goldLimit) {
    throw new Error(
      "Spend limit ordering invariant violated — contract may be incorrect."
    );
  }
  console.log("  OK Spend limit ordering: Bronze < Silver < Gold");

  log("\n  Bronze spend limit:", `${ethers.formatEther(bronzeLimit)} ETH`);
  log("  Silver spend limit:", `${ethers.formatEther(silverLimit)} ETH`);
  log("  Gold spend limit:  ", `${ethers.formatEther(goldLimit)} ETH`);
}

async function verifySourceCode(address) {
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("\n  Source verification skipped (local network)");
    return;
  }

  if (!process.env.ARBISCAN_API_KEY) {
    console.log(
      "\n  WARNING ARBISCAN_API_KEY not set — skipping source code verification.\n" +
        "     Set it in .env and run:\n" +
        `     npx hardhat verify --network ${network.name} ${address}`
    );
    return;
  }

  console.log("\n" + separator("─"));
  console.log("  Submitting source code to Arbiscan");
  console.log(separator("─"));

  try {
    // AgentGuard constructor takes no arguments.
    await hre.run("verify:verify", {
      address,
      constructorArguments: [],
    });
    console.log("  OK Source code verified on Arbiscan");
  } catch (err) {
    if (err.message && err.message.includes("Already Verified")) {
      console.log("  OK Contract already verified on Arbiscan");
    } else {
      console.warn("  WARNING Verification failed:", err.message);
      console.warn("     You can retry manually:");
      console.warn(`     npx hardhat verify --network ${network.name} ${address}`);
    }
  }
}

function printSummary(address, deployer) {
  console.log("\n" + separator("=", 60));
  console.log("  AgentGuard v1.0 -- Deployment Complete");
  console.log(separator("=", 60));
  log("Network:", network.name);
  log("Contract:", address);
  log("Owner:", deployer.address);

  if (network.name === "arbitrumSepolia") {
    console.log("\n  Block Explorer:");
    console.log(`  https://sepolia.arbiscan.io/address/${address}`);
    console.log("\n  Next steps:");
    console.log("  1. Fund the treasury via depositTreasury()");
    console.log("  2. Register your first agent via registerAgent()");
    console.log("  3. Record task credentials as agent work is evaluated");
    console.log("  4. Agents create spend requests; owner approves/rejects");
  }

  console.log("\n" + separator("=", 60) + "\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + separator("=", 60));
  console.log("  AgentGuard v1.0 -- Deployment Script");
  console.log(separator("=", 60));

  const [deployer] = await ethers.getSigners();

  await validateEnvironment(deployer);

  const { agentGuard, address } = await deployContract(deployer);

  await waitForConfirmations(agentGuard);

  await verifyDeployment(agentGuard, deployer);

  await verifySourceCode(address);

  printSummary(address, deployer);
}

main().catch((error) => {
  console.error("\n" + separator("!", 60));
  console.error("  Deployment failed");
  console.error(separator("!", 60));
  console.error(error);
  process.exitCode = 1;
});