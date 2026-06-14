// test/AgentGuard.t.js
// ─────────────────────────────────────────────────────────────────────────────
// AgentGuard v1.0 — Full Test Suite
//
// Run: npx hardhat test
//
// Coverage areas:
//   1.  Deployment & initial state
//   2.  Treasury management (deposit, available balance, direct transfer guard)
//   3.  Agent registration
//   4.  Task credential recording (including evidenceHash and TaskType)
//   5.  Credential level upgrades (Bronze / Silver / Gold)
//   6.  Spend request creation (permission enforcement)
//   7.  Spend request approval
//   8.  Spend request rejection
//   9.  Spend request cancellation
//   10. Spend request execution (ETH transfer)
//   11. View helpers (getAgentSummary, getPendingRequests, getApprovedRequests)
//   12. Access control (onlyOwner, onlyAgentOwner)
//   13. Edge cases and attack vectors
// ─────────────────────────────────────────────────────────────────────────────

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// ── TaskType enum mirror (matches Solidity enum order) ───────────────────────
const TaskType = {
  TreasuryAnalysis:  0,
  GovernanceReview:  1,
  RiskAssessment:    2,
};

// ── CredentialLevel enum mirror ───────────────────────────────────────────────
const CredentialLevel = {
  None:   0,
  Bronze: 1,
  Silver: 2,
  Gold:   3,
};

// ── RequestStatus enum mirror ─────────────────────────────────────────────────
const RequestStatus = {
  Pending:   0,
  Approved:  1,
  Executed:  2,
  Rejected:  3,
  Cancelled: 4,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Produces a deterministic bytes32 evidence hash for a given task string.
 * Mirrors what an off-chain oracle would produce:
 *   keccak256(abi.encodePacked(ipfsCID))
 */
function evidenceHash(taskId) {
  return ethers.keccak256(ethers.toUtf8Bytes(`evidence:${taskId}`));
}

/**
 * Records `count` task credentials for `agent` with the given `score`,
 * starting task IDs from `startIndex`.
 * Returns the last task ID recorded.
 */
async function recordTasks(contract, agent, count, score, startIndex = 0, type = TaskType.TreasuryAnalysis) {
  for (let i = startIndex; i < startIndex + count; i++) {
    const taskId = `task-${agent.address.slice(2, 6)}-${i}`;
    await contract.recordTaskCredential(
      agent.address,
      taskId,
      type,
      score,
      evidenceHash(taskId)
    );
  }
  return `task-${agent.address.slice(2, 6)}-${startIndex + count - 1}`;
}

/**
 * Returns the timestamp of the most recently mined block.
 * NOTE: When used BEFORE a transaction, the returned timestamp will be one
 * block behind the tx's block. Always call AFTER the tx has been mined, or
 * use anyValue for timestamp arguments in event assertions.
 */
async function getBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block.timestamp);
}

/**
 * Returns the block timestamp for the block in which a transaction was mined.
 * Use this instead of getBlockTimestamp() when asserting event timestamp args.
 *
 * @param {ethers.TransactionResponse} tx - The transaction response (not yet waited)
 * @returns {Promise<BigInt>}
 */
async function getTxTimestamp(tx) {
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return BigInt(block.timestamp);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Base fixture: deploys AgentGuard and provides named signers.
 * No treasury funded, no agents registered.
 */
async function deployFixture() {
  const [owner, agentOwner, agentOwner2, stranger] = await ethers.getSigners();

  const AgentGuard = await ethers.getContractFactory("AgentGuard");
  const agentGuard = await AgentGuard.deploy();
  await agentGuard.waitForDeployment();

  return { agentGuard, owner, agentOwner, agentOwner2, stranger };
}

/**
 * Funded fixture: treasury seeded with 10 ETH.
 */
async function fundedFixture() {
  const base = await deployFixture();
  await base.agentGuard
    .connect(base.owner)
    .depositTreasury({ value: ethers.parseEther("10") });
  return base;
}

/**
 * Registered fixture: one agent registered, treasury funded.
 */
async function registeredAgentFixture() {
  const base = await fundedFixture();
  await base.agentGuard.connect(base.agentOwner).registerAgent("AlphaAgent");
  return base;
}

/**
 * Bronze fixture: agent has exactly Bronze credential level.
 * BRONZE_MIN_TASKS = 3, BRONZE_MIN_SCORE = 60
 */
async function bronzeAgentFixture() {
  const base = await registeredAgentFixture();
  await recordTasks(base.agentGuard, base.agentOwner, 3, 80);
  return base;
}

/**
 * Silver fixture: agent has exactly Silver credential level.
 * SILVER_MIN_TASKS = 10, SILVER_MIN_SCORE = 75
 */
async function silverAgentFixture() {
  const base = await registeredAgentFixture();
  await recordTasks(base.agentGuard, base.agentOwner, 10, 80);
  return base;
}

/**
 * Gold fixture: agent has exactly Gold credential level.
 * GOLD_MIN_TASKS = 25, GOLD_MIN_SCORE = 90
 */
async function goldAgentFixture() {
  const base = await registeredAgentFixture();
  await recordTasks(base.agentGuard, base.agentOwner, 25, 95);
  return base;
}

/**
 * Pending request fixture: Silver agent with one pending request for 0.5 ETH.
 */
async function pendingRequestFixture() {
  const base = await silverAgentFixture();
  await base.agentGuard
    .connect(base.agentOwner)
    .createSpendRequest(
      base.agentOwner.address,
      ethers.parseEther("0.5"),
      "Q3 governance analysis tooling"
    );
  return { ...base, requestId: 0n };
}

/**
 * Bronze pending request fixture: Bronze agent with one pending request.
 * Bronze pendingLimit = 1, so one request fills the cap.
 */
async function bronzePendingRequestFixture() {
  const base = await bronzeAgentFixture();
  await base.agentGuard
    .connect(base.agentOwner)
    .createSpendRequest(
      base.agentOwner.address,
      ethers.parseEther("0.05"),
      "Bronze pending request"
    );
  return { ...base, requestId: 0n };
}

/**
 * Approved request fixture: pending request has been approved by owner.
 */
async function approvedRequestFixture() {
  const base = await pendingRequestFixture();
  await base.agentGuard.connect(base.owner).approveSpendRequest(0n);
  return base;
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═════════════════════════════════════════════════════════════════════════════

describe("AgentGuard", function () {

  // ── 1. Deployment ──────────────────────────────────────────────────────────
  describe("1. Deployment & initial state", function () {
    it("sets the deployer as owner", async function () {
      const { agentGuard, owner } = await loadFixture(deployFixture);
      expect(await agentGuard.owner()).to.equal(owner.address);
    });

    it("starts with zero treasury balance", async function () {
      const { agentGuard } = await loadFixture(deployFixture);
      expect(await agentGuard.availableTreasury()).to.equal(0n);
      expect(await ethers.provider.getBalance(await agentGuard.getAddress())).to.equal(0n);
    });

    it("starts with zero registered agents", async function () {
      const { agentGuard } = await loadFixture(deployFixture);
      expect(await agentGuard.totalAgents()).to.equal(0n);
    });

    it("exposes correct spend limit constants", async function () {
      const { agentGuard } = await loadFixture(deployFixture);
      expect(await agentGuard.BRONZE_SPEND_LIMIT()).to.equal(ethers.parseEther("0.1"));
      expect(await agentGuard.SILVER_SPEND_LIMIT()).to.equal(ethers.parseEther("1"));
      expect(await agentGuard.GOLD_SPEND_LIMIT()).to.equal(ethers.parseEther("10"));
    });

    it("exposes correct credential threshold constants", async function () {
      const { agentGuard } = await loadFixture(deployFixture);
      expect(await agentGuard.BRONZE_MIN_TASKS()).to.equal(3n);
      expect(await agentGuard.SILVER_MIN_TASKS()).to.equal(10n);
      expect(await agentGuard.GOLD_MIN_TASKS()).to.equal(25n);
      expect(await agentGuard.BRONZE_MIN_SCORE()).to.equal(60n);
      expect(await agentGuard.SILVER_MIN_SCORE()).to.equal(75n);
      expect(await agentGuard.GOLD_MIN_SCORE()).to.equal(90n);
    });
  });

  // ── 2. Treasury management ─────────────────────────────────────────────────
  describe("2. Treasury management", function () {
    it("allows owner to deposit ETH", async function () {
      const { agentGuard, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("5");

      await expect(agentGuard.connect(owner).depositTreasury({ value: amount }))
        .to.emit(agentGuard, "TreasuryDeposited")
        .withArgs(owner.address, amount, amount);

      expect(await agentGuard.availableTreasury()).to.equal(amount);
    });

    it("rejects deposits from non-owner", async function () {
      const { agentGuard, stranger } = await loadFixture(deployFixture);
      await expect(
        agentGuard.connect(stranger).depositTreasury({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(agentGuard, "OwnableUnauthorizedAccount");
    });

    it("rejects zero-value deposits", async function () {
      const { agentGuard, owner } = await loadFixture(deployFixture);
      await expect(
        agentGuard.connect(owner).depositTreasury({ value: 0n })
      ).to.be.revertedWithCustomError(agentGuard, "ZeroAmount");
    });

    it("accumulates multiple deposits correctly", async function () {
      const { agentGuard, owner } = await loadFixture(deployFixture);
      await agentGuard.connect(owner).depositTreasury({ value: ethers.parseEther("3") });
      await agentGuard.connect(owner).depositTreasury({ value: ethers.parseEther("2") });
      expect(await agentGuard.availableTreasury()).to.equal(ethers.parseEther("5"));
    });

    // FIX #1: receive() no longer reverts — it emits UnexpectedDeposit and accepts ETH.
    // The old DirectTransferNotAllowed error is commented out in the contract.
    it("emits UnexpectedDeposit on direct ETH transfers (receive fallback)", async function () {
      const { agentGuard, stranger } = await loadFixture(deployFixture);
      const contractAddress = await agentGuard.getAddress();
      const amount = ethers.parseEther("1");

      await expect(
        stranger.sendTransaction({ to: contractAddress, value: amount })
      )
        .to.emit(agentGuard, "UnexpectedDeposit")
        .withArgs(stranger.address, amount, amount);

      // Funds are held by the contract (not reverted)
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(amount);
    });

    it("availableTreasury equals balance minus escrowed amounts", async function () {
      const { agentGuard, owner, agentOwner } = await loadFixture(silverAgentFixture);

      const available = await agentGuard.availableTreasury();

      // Create a pending then approved request — escrowed amount reduces available
      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Test");
      await agentGuard.connect(owner).approveSpendRequest(0n);

      expect(await agentGuard.availableTreasury()).to.equal(
        available - ethers.parseEther("0.5")
      );
    });
  });

  // ── 3. Agent registration ──────────────────────────────────────────────────
  describe("3. Agent registration", function () {
    // FIX #2: getBlockTimestamp() called before tx mines returns the PREVIOUS block's
    // timestamp. The tx mines a new block, so timestamp is always off by one block.
    // Fix: use anyValue for the timestamp argument, which is purely block.timestamp
    // and not meaningful business logic to pin to an exact value.
    it("allows any address to register as an agent", async function () {
      const { agentGuard, agentOwner } = await loadFixture(deployFixture);

      await expect(agentGuard.connect(agentOwner).registerAgent("AlphaAgent"))
        .to.emit(agentGuard, "AgentRegistered")
        .withArgs(agentOwner.address, "AlphaAgent", anyValue);
    });

    it("increments total agent count on registration", async function () {
      const { agentGuard, agentOwner, agentOwner2 } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("Agent1");
      await agentGuard.connect(agentOwner2).registerAgent("Agent2");
      expect(await agentGuard.totalAgents()).to.equal(2n);
    });

    it("stores agent profile correctly", async function () {
      const { agentGuard, agentOwner } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("AlphaAgent");

      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.owner).to.equal(agentOwner.address);
      expect(summary.name).to.equal("AlphaAgent");
      expect(summary.completedTasks).to.equal(0n);
      expect(summary.averageScore).to.equal(0n);
      expect(summary.credentialLevel).to.equal(CredentialLevel.None);
      expect(summary.totalReleasedWei).to.equal(0n);
      expect(summary.pendingCount).to.equal(0n);
    });

    it("rejects duplicate registration from the same address", async function () {
      const { agentGuard, agentOwner } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("First");

      await expect(
        agentGuard.connect(agentOwner).registerAgent("Second")
      ).to.be.revertedWithCustomError(agentGuard, "AgentAlreadyRegistered")
        .withArgs(agentOwner.address);
    });

    it("rejects empty agent name", async function () {
      const { agentGuard, agentOwner } = await loadFixture(deployFixture);
      await expect(
        agentGuard.connect(agentOwner).registerAgent("")
      ).to.be.revertedWithCustomError(agentGuard, "EmptyName");
    });

    it("isRegistered returns true after registration", async function () {
      const { agentGuard, agentOwner, stranger } = await loadFixture(deployFixture);
      expect(await agentGuard.isRegistered(agentOwner.address)).to.be.false;
      await agentGuard.connect(agentOwner).registerAgent("Agent");
      expect(await agentGuard.isRegistered(agentOwner.address)).to.be.true;
      expect(await agentGuard.isRegistered(stranger.address)).to.be.false;
    });

    it("agentAtIndex returns correct address", async function () {
      const { agentGuard, agentOwner, agentOwner2 } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("Agent1");
      await agentGuard.connect(agentOwner2).registerAgent("Agent2");

      expect(await agentGuard.agentAtIndex(0n)).to.equal(agentOwner.address);
      expect(await agentGuard.agentAtIndex(1n)).to.equal(agentOwner2.address);
    });
  });

  // ── 4. Task credential recording ──────────────────────────────────────────
  describe("4. Task credential recording", function () {
    // FIX #3: same timestamp-before-tx issue. Use anyValue for timestamp arg.
    it("records a credential and emits TaskCredentialRecorded", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      const hash = evidenceHash("task-001");

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address,
          "task-001",
          TaskType.TreasuryAnalysis,
          85,
          hash
        )
      )
        .to.emit(agentGuard, "TaskCredentialRecorded")
        .withArgs(
          agentOwner.address,
          "task-001",
          TaskType.TreasuryAnalysis,
          85n,
          hash,
          85n,      // newAverageScore
          1n,       // completedTasks
          anyValue  // timestamp — block.timestamp of the mined tx, not predictable beforehand
        );
    });

    it("only owner can record credentials", async function () {
      const { agentGuard, agentOwner, stranger } = await loadFixture(registeredAgentFixture);

      await expect(
        agentGuard.connect(stranger).recordTaskCredential(
          agentOwner.address,
          "task-001",
          TaskType.GovernanceReview,
          90,
          evidenceHash("task-001")
        )
      ).to.be.revertedWithCustomError(agentGuard, "OwnableUnauthorizedAccount");
    });

    it("rejects score above 100", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address,
          "task-001",
          TaskType.RiskAssessment,
          101,
          evidenceHash("task-001")
        )
      ).to.be.revertedWithCustomError(agentGuard, "InvalidScore").withArgs(101n);
    });

    it("allows score of exactly 0 and 100", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address, "task-zero", TaskType.TreasuryAnalysis, 0, evidenceHash("task-zero")
        )
      ).to.not.be.reverted;

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address, "task-hundred", TaskType.TreasuryAnalysis, 100, evidenceHash("task-hundred")
        )
      ).to.not.be.reverted;
    });

    it("rejects empty taskId", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address, "", TaskType.TreasuryAnalysis, 80, evidenceHash("")
        )
      ).to.be.revertedWithCustomError(agentGuard, "EmptyTaskId");
    });

    it("rejects zero evidenceHash", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address, "task-001", TaskType.TreasuryAnalysis, 80, ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(agentGuard, "ZeroEvidenceHash");
    });

    it("rejects duplicate taskId for the same agent", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      const hash = evidenceHash("task-dup");

      await agentGuard.recordTaskCredential(
        agentOwner.address, "task-dup", TaskType.TreasuryAnalysis, 80, hash
      );

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address, "task-dup", TaskType.TreasuryAnalysis, 90, evidenceHash("task-dup-2")
        )
      ).to.be.revertedWithCustomError(agentGuard, "DuplicateTaskId")
        .withArgs(agentOwner.address, "task-dup");
    });

    it("allows the same taskId for different agents", async function () {
      const { agentGuard, agentOwner, agentOwner2 } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("Agent1");
      await agentGuard.connect(agentOwner2).registerAgent("Agent2");

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address, "shared-task", TaskType.TreasuryAnalysis, 80, evidenceHash("shared-1")
        )
      ).to.not.be.reverted;

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner2.address, "shared-task", TaskType.TreasuryAnalysis, 80, evidenceHash("shared-2")
        )
      ).to.not.be.reverted;
    });

    it("computes rolling average score correctly", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await agentGuard.recordTaskCredential(
        agentOwner.address, "t1", TaskType.TreasuryAnalysis, 80, evidenceHash("t1")
      );
      await agentGuard.recordTaskCredential(
        agentOwner.address, "t2", TaskType.TreasuryAnalysis, 60, evidenceHash("t2")
      );
      await agentGuard.recordTaskCredential(
        agentOwner.address, "t3", TaskType.TreasuryAnalysis, 70, evidenceHash("t3")
      );

      // (80 + 60 + 70) / 3 = 70
      expect(await agentGuard.getAgentAverageScore(agentOwner.address)).to.equal(70n);
    });

    it("stores all TaskType values correctly", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await agentGuard.recordTaskCredential(
        agentOwner.address, "t-treasury", TaskType.TreasuryAnalysis, 80, evidenceHash("t-treasury")
      );
      await agentGuard.recordTaskCredential(
        agentOwner.address, "t-gov", TaskType.GovernanceReview, 80, evidenceHash("t-gov")
      );
      await agentGuard.recordTaskCredential(
        agentOwner.address, "t-risk", TaskType.RiskAssessment, 80, evidenceHash("t-risk")
      );

      const creds = await agentGuard.getCredentials(agentOwner.address);
      expect(creds[0].taskType).to.equal(TaskType.TreasuryAnalysis);
      expect(creds[1].taskType).to.equal(TaskType.GovernanceReview);
      expect(creds[2].taskType).to.equal(TaskType.RiskAssessment);
    });

    it("stores evidenceHash immutably on-chain", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      const hash = evidenceHash("audit-report-v1");

      await agentGuard.recordTaskCredential(
        agentOwner.address, "audit-001", TaskType.RiskAssessment, 95, hash
      );

      const cred = await agentGuard.getCredentialAt(agentOwner.address, 0n);
      expect(cred.evidenceHash).to.equal(hash);
    });

    it("rejects credential for unregistered agent", async function () {
      const { agentGuard, stranger } = await loadFixture(deployFixture);

      await expect(
        agentGuard.recordTaskCredential(
          stranger.address, "task-001", TaskType.TreasuryAnalysis, 80, evidenceHash("task-001")
        )
      ).to.be.revertedWithCustomError(agentGuard, "AgentNotRegistered");
    });

    it("isTaskIdUsed returns correct values", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      expect(await agentGuard.isTaskIdUsed(agentOwner.address, "task-001")).to.be.false;

      await agentGuard.recordTaskCredential(
        agentOwner.address, "task-001", TaskType.TreasuryAnalysis, 80, evidenceHash("task-001")
      );

      expect(await agentGuard.isTaskIdUsed(agentOwner.address, "task-001")).to.be.true;
    });
  });

  // ── 5. Credential level upgrades ──────────────────────────────────────────
  describe("5. Credential level upgrades", function () {
    it("starts at CredentialLevel.None", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.None);
    });

    it("does NOT upgrade to Bronze below BRONZE_MIN_TASKS", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      // Record 2 tasks (threshold is 3)
      await recordTasks(agentGuard, agentOwner, 2, 80);
      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.None);
    });

    it("does NOT upgrade to Bronze with score below BRONZE_MIN_SCORE", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      // Record 3 tasks but with score 59 (threshold is 60)
      await recordTasks(agentGuard, agentOwner, 3, 59);
      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.None);
    });

    // FIX #4: The original test had a dangling unawaited tx at the top:
    //   const tx = agentGuard.recordTaskCredential(...) // no await!
    // Without await, Ethers still dispatches the transaction, causing the agent to
    // accumulate a 3rd task BEFORE recordTasks runs its 2 tasks. By the time
    // "bronze-trigger" fires, the agent already has 4 tasks and Bronze was already
    // granted on task 3 — so no CredentialLevelChanged fires on task 4.
    // Fix: remove the dangling call entirely.
    //
    // FIX (timestamp): use anyValue for the timestamp arg.
    it("upgrades to Bronze at exactly BRONZE_MIN_TASKS with qualifying score", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      // Record 2 tasks first (below threshold)
      await recordTasks(agentGuard, agentOwner, 2, 80);

      // 3rd task triggers Bronze upgrade
      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address,
          "bronze-trigger",
          TaskType.TreasuryAnalysis,
          80,
          evidenceHash("bronze-trigger")
        )
      )
        .to.emit(agentGuard, "CredentialLevelChanged")
        .withArgs(
          agentOwner.address,
          CredentialLevel.None,
          CredentialLevel.Bronze,
          anyValue  // block.timestamp of the mined tx
        );

      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.Bronze);
    });

    // FIX #5: anyValue for timestamp arg.
    it("upgrades from Bronze to Silver at SILVER_MIN_TASKS with qualifying score", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);

      // Need 7 more tasks to reach 10 total (Silver threshold)
      await recordTasks(agentGuard, agentOwner, 6, 80, 3);

      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address,
          "silver-trigger",
          TaskType.GovernanceReview,
          80,
          evidenceHash("silver-trigger")
        )
      )
        .to.emit(agentGuard, "CredentialLevelChanged")
        .withArgs(
          agentOwner.address,
          CredentialLevel.Bronze,
          CredentialLevel.Silver,
          anyValue  // block.timestamp of the mined tx
        );

      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.Silver);
    });

    // FIX #6: anyValue for timestamp arg.
    it("upgrades from Silver to Gold at GOLD_MIN_TASKS with qualifying score", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      // Record 24 tasks with score 95 (qualifies for all tiers)
      await recordTasks(agentGuard, agentOwner, 24, 95);

      // 25th task triggers Gold
      await expect(
        agentGuard.recordTaskCredential(
          agentOwner.address,
          "gold-trigger",
          TaskType.RiskAssessment,
          95,
          evidenceHash("gold-trigger")
        )
      )
        .to.emit(agentGuard, "CredentialLevelChanged")
        .withArgs(
          agentOwner.address,
          CredentialLevel.Silver,
          CredentialLevel.Gold,
          anyValue  // block.timestamp of the mined tx
        );

      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.Gold);
    });

    it("does NOT upgrade to Silver if score drops below SILVER_MIN_SCORE", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      // Record 3 tasks at 80 (Bronze eligible)
      await recordTasks(agentGuard, agentOwner, 3, 80);

      // Record 7 more tasks at very low scores — drags average below Silver threshold
      await recordTasks(agentGuard, agentOwner, 7, 30, 3);

      // Average = (3*80 + 7*30) / 10 = (240 + 210) / 10 = 45 — below Silver (75)
      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.None);
      expect(summary.averageScore).to.equal(45n);
    });

    it("emits CredentialLevelChanged only when level actually changes", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);

      // This 4th task does not change level — still Bronze
      const filter = agentGuard.filters.CredentialLevelChanged(agentOwner.address);
      const before = await agentGuard.queryFilter(filter);

      await agentGuard.recordTaskCredential(
        agentOwner.address, "extra-bronze", TaskType.TreasuryAnalysis, 80, evidenceHash("extra-bronze")
      );

      const after = await agentGuard.queryFilter(filter);
      expect(after.length).to.equal(before.length); // no new event
    });

    // FIX #7: The original test used scores 80 (10 tasks) then 95 (15 tasks).
    // Average = (10*80 + 15*95) / 25 = (800 + 1425) / 25 = 2225 / 25 = 89.
    // 89 < GOLD_MIN_SCORE (90) → agent stays Silver, not Gold.
    // Fix: reset and record all 25 tasks at score 95 from scratch.
    // avg = 25*95/25 = 95 ≥ 90 ✓
    it("getAgentSpendLimit reflects credential level", async function () {
      const { agentGuard, agentOwner } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("TestAgent");

      // None → 0
      expect(await agentGuard.getAgentSpendLimit(agentOwner.address)).to.equal(0n);

      // Bronze (3 tasks @ 95)
      await recordTasks(agentGuard, agentOwner, 3, 95);
      expect(await agentGuard.getAgentSpendLimit(agentOwner.address)).to.equal(
        ethers.parseEther("0.1")
      );

      // Silver (10 tasks total @ 95)
      await recordTasks(agentGuard, agentOwner, 7, 95, 3);
      expect(await agentGuard.getAgentSpendLimit(agentOwner.address)).to.equal(
        ethers.parseEther("1")
      );

      // Gold (25 tasks total @ 95): avg = 95 ≥ 90 ✓
      await recordTasks(agentGuard, agentOwner, 15, 95, 10);
      expect(await agentGuard.getAgentSpendLimit(agentOwner.address)).to.equal(
        ethers.parseEther("10")
      );
    });
  });

  // ── 6. Spend request creation ──────────────────────────────────────────────
  describe("6. Spend request creation", function () {
    // FIX #8: anyValue for timestamp arg.
    it("Bronze agent can create a request within Bronze limit", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);
      const amount = ethers.parseEther("0.05"); // below 0.1 ETH Bronze limit

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, amount, "Analysis tooling")
      )
        .to.emit(agentGuard, "SpendRequestCreated")
        .withArgs(0n, agentOwner.address, amount, "Analysis tooling", anyValue);
    });

    it("reverts when agent has no credential (None level)", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.01"), "purpose")
      ).to.be.revertedWithCustomError(agentGuard, "NoCredential")
        .withArgs(agentOwner.address);
    });

    it("reverts when amount exceeds credential tier limit", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);
      const tooMuch = ethers.parseEther("0.11"); // above Bronze limit of 0.1

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, tooMuch, "Too much")
      ).to.be.revertedWithCustomError(agentGuard, "ExceedsSpendLimit")
        .withArgs(tooMuch, ethers.parseEther("0.1"));
    });

    it("reverts when pending count exceeds tier cap", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);
      // Bronze cap is 1 pending request

      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "First");

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "Second")
      ).to.be.revertedWithCustomError(agentGuard, "ExceedsPendingLimit")
        .withArgs(1n, 1n);
    });

    it("Silver agent pending cap is 3", async function () {
      const { agentGuard, agentOwner } = await loadFixture(silverAgentFixture);

      for (let i = 0; i < 3; i++) {
        await agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), `Request ${i}`);
      }

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Fourth")
      ).to.be.revertedWithCustomError(agentGuard, "ExceedsPendingLimit");
    });

    it("reverts for zero amount", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, 0n, "Zero request")
      ).to.be.revertedWithCustomError(agentGuard, "ZeroAmount");
    });

    it("reverts for empty purpose", async function () {
      const { agentGuard, agentOwner } = await loadFixture(bronzeAgentFixture);

      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "")
      ).to.be.revertedWithCustomError(agentGuard, "EmptyPurpose");
    });

    it("only agent owner can create requests for their agent", async function () {
      const { agentGuard, agentOwner, stranger } = await loadFixture(bronzeAgentFixture);

      await expect(
        agentGuard
          .connect(stranger)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "Hijack")
      ).to.be.revertedWithCustomError(agentGuard, "NotAgentOwner");
    });

    // FIX #9: Original test called ag.connect(agentOwner).depositTreasury(...).
    // agentOwner is accounts[1]; only the deployer (accounts[0] = owner) can call
    // depositTreasury (onlyOwner). Fix: use owner for the deposit.
    it("request IDs are monotonically increasing across agents", async function () {
      const { owner, agentOwner, agentOwner2 } = await loadFixture(deployFixture);

      // Deploy a fresh contract for isolation
      const AgentGuard = await ethers.getContractFactory("AgentGuard");
      const ag = await AgentGuard.deploy();
      await ag.waitForDeployment();

      // Fund treasury as owner (not agentOwner)
      await ag.connect(owner).depositTreasury({ value: ethers.parseEther("10") });

      await ag.connect(agentOwner).registerAgent("A1");
      await ag.connect(agentOwner2).registerAgent("A2");
      await recordTasks(ag, agentOwner, 3, 80);
      await recordTasks(ag, agentOwner2, 3, 80);

      const tx1 = await ag
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "First");
      const r1 = await tx1.wait();
      const ev1 = r1.logs.find(
        (l) => l.fragment && l.fragment.name === "SpendRequestCreated"
      );

      const tx2 = await ag
        .connect(agentOwner2)
        .createSpendRequest(agentOwner2.address, ethers.parseEther("0.05"), "Second");
      const r2 = await tx2.wait();
      const ev2 = r2.logs.find(
        (l) => l.fragment && l.fragment.name === "SpendRequestCreated"
      );

      expect(ev1.args[0]).to.equal(0n);
      expect(ev2.args[0]).to.equal(1n);
    });
  });

  // ── 7. Spend request approval ──────────────────────────────────────────────
  describe("7. Spend request approval", function () {
    // FIX #10: anyValue for timestamp arg.
    it("owner can approve a pending request", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        pendingRequestFixture
      );

      await expect(agentGuard.connect(owner).approveSpendRequest(requestId))
        .to.emit(agentGuard, "SpendRequestApproved")
        .withArgs(
          requestId,
          agentOwner.address,
          ethers.parseEther("0.5"),
          anyValue  // block.timestamp of the mined tx
        );

      const req = await agentGuard.getSpendRequest(requestId);
      expect(req.status).to.equal(RequestStatus.Approved);
    });

    it("approval moves request to approved list", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        pendingRequestFixture
      );

      expect(
        (await agentGuard.getPendingRequests(agentOwner.address)).length
      ).to.equal(1);
      expect(
        (await agentGuard.getApprovedRequests(agentOwner.address)).length
      ).to.equal(0);

      await agentGuard.connect(owner).approveSpendRequest(requestId);

      expect(
        (await agentGuard.getPendingRequests(agentOwner.address)).length
      ).to.equal(0);
      expect(
        (await agentGuard.getApprovedRequests(agentOwner.address)).length
      ).to.equal(1);
    });

    it("approval escrows the correct amount", async function () {
      const { agentGuard, owner } = await loadFixture(pendingRequestFixture);
      const totalBalance = await ethers.provider.getBalance(
        await agentGuard.getAddress()
      );

      await agentGuard.connect(owner).approveSpendRequest(0n);

      const available = await agentGuard.availableTreasury();
      expect(available).to.equal(totalBalance - ethers.parseEther("0.5"));
    });

    it("reverts when approving a non-pending request", async function () {
      const { agentGuard, owner, requestId } = await loadFixture(approvedRequestFixture);

      await expect(
        agentGuard.connect(owner).approveSpendRequest(requestId)
      ).to.be.revertedWithCustomError(agentGuard, "WrongStatus")
        .withArgs(requestId, RequestStatus.Approved, RequestStatus.Pending);
    });

    it("reverts when treasury cannot cover the approved amount", async function () {
      const { agentGuard, owner, agentOwner } = await loadFixture(silverAgentFixture);

      // Deploy a fresh contract with tiny treasury
      const AgentGuard = await ethers.getContractFactory("AgentGuard");
      const ag = await AgentGuard.deploy();
      await ag.waitForDeployment();

      // Fund with only 0.3 ETH
      await ag.connect(owner).depositTreasury({ value: ethers.parseEther("0.3") });
      await ag.connect(agentOwner).registerAgent("PoorAgent");
      await recordTasks(ag, agentOwner, 10, 80); // Silver

      // Request 0.5 ETH (within Silver limit but above treasury)
      await ag
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Insufficient funds test");

      await expect(
        ag.connect(owner).approveSpendRequest(0n)
      ).to.be.revertedWithCustomError(ag, "InsufficientAvailableFunds");
    });

    it("only owner can approve requests", async function () {
      const { agentGuard, agentOwner, stranger, requestId } = await loadFixture(
        pendingRequestFixture
      );

      await expect(
        agentGuard.connect(stranger).approveSpendRequest(requestId)
      ).to.be.revertedWithCustomError(agentGuard, "OwnableUnauthorizedAccount");

      await expect(
        agentGuard.connect(agentOwner).approveSpendRequest(requestId)
      ).to.be.revertedWithCustomError(agentGuard, "OwnableUnauthorizedAccount");
    });

    it("reverts for non-existent request ID", async function () {
      const { agentGuard, owner } = await loadFixture(pendingRequestFixture);

      await expect(
        agentGuard.connect(owner).approveSpendRequest(999n)
      ).to.be.revertedWithCustomError(agentGuard, "RequestNotFound").withArgs(999n);
    });
  });

  // ── 8. Spend request rejection ─────────────────────────────────────────────
  describe("8. Spend request rejection", function () {
    // FIX #11: anyValue for timestamp arg.
    it("owner can reject a pending request with reason", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        pendingRequestFixture
      );
      const reason = "Purpose does not align with Q3 treasury strategy";

      await expect(
        agentGuard.connect(owner).rejectSpendRequest(requestId, reason)
      )
        .to.emit(agentGuard, "SpendRequestRejected")
        .withArgs(requestId, agentOwner.address, reason, anyValue);

      const req = await agentGuard.getSpendRequest(requestId);
      expect(req.status).to.equal(RequestStatus.Rejected);
      expect(req.rejectionReason).to.equal(reason);
    });

    it("rejection decrements pending count", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        pendingRequestFixture
      );

      await agentGuard.connect(owner).rejectSpendRequest(requestId, "Rejected");

      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.pendingCount).to.equal(0n);
    });

    it("reverts rejection with empty reason", async function () {
      const { agentGuard, owner, requestId } = await loadFixture(pendingRequestFixture);

      await expect(
        agentGuard.connect(owner).rejectSpendRequest(requestId, "")
      ).to.be.revertedWithCustomError(agentGuard, "EmptyReason");
    });

    it("cannot reject an already-approved request", async function () {
      const { agentGuard, owner, requestId } = await loadFixture(approvedRequestFixture);

      await expect(
        agentGuard.connect(owner).rejectSpendRequest(requestId, "Too late")
      ).to.be.revertedWithCustomError(agentGuard, "WrongStatus")
        .withArgs(requestId, RequestStatus.Approved, RequestStatus.Pending);
    });

    it("only owner can reject requests", async function () {
      const { agentGuard, agentOwner, stranger, requestId } = await loadFixture(
        pendingRequestFixture
      );

      await expect(
        agentGuard.connect(stranger).rejectSpendRequest(requestId, "Hacker")
      ).to.be.revertedWithCustomError(agentGuard, "OwnableUnauthorizedAccount");
    });
  });

  // ── 9. Spend request cancellation ─────────────────────────────────────────
  describe("9. Spend request cancellation", function () {
    // FIX #12: anyValue for timestamp arg.
    it("agent owner can cancel their own pending request", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(pendingRequestFixture);

      await expect(
        agentGuard.connect(agentOwner).cancelSpendRequest(requestId)
      )
        .to.emit(agentGuard, "SpendRequestCancelled")
        .withArgs(requestId, agentOwner.address, agentOwner.address, anyValue);

      const req = await agentGuard.getSpendRequest(requestId);
      expect(req.status).to.equal(RequestStatus.Cancelled);
    });

    // FIX #13: anyValue for timestamp arg.
    it("protocol owner can cancel a pending request", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        pendingRequestFixture
      );

      await expect(agentGuard.connect(owner).cancelSpendRequest(requestId))
        .to.emit(agentGuard, "SpendRequestCancelled")
        .withArgs(requestId, agentOwner.address, owner.address, anyValue);
    });

    it("protocol owner can cancel an approved request and release escrow", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        approvedRequestFixture
      );

      const availableBefore = await agentGuard.availableTreasury();

      await expect(agentGuard.connect(owner).cancelSpendRequest(requestId))
        .to.emit(agentGuard, "SpendRequestCancelled");

      const availableAfter = await agentGuard.availableTreasury();
      expect(availableAfter).to.equal(availableBefore + ethers.parseEther("0.5"));

      expect(
        (await agentGuard.getApprovedRequests(agentOwner.address)).length
      ).to.equal(0);
    });

    it("agent owner cannot cancel an approved request", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);

      await expect(
        agentGuard.connect(agentOwner).cancelSpendRequest(requestId)
      ).to.be.revertedWithCustomError(agentGuard, "UnauthorisedCancellation")
        .withArgs(requestId, agentOwner.address);
    });

    it("stranger cannot cancel any request", async function () {
      const { agentGuard, stranger, requestId } = await loadFixture(pendingRequestFixture);

      await expect(
        agentGuard.connect(stranger).cancelSpendRequest(requestId)
      ).to.be.revertedWithCustomError(agentGuard, "UnauthorisedCancellation");
    });

    it("cannot cancel an executed request", async function () {
      const { agentGuard, owner, agentOwner, requestId } = await loadFixture(
        approvedRequestFixture
      );

      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId);

      await expect(
        agentGuard.connect(owner).cancelSpendRequest(requestId)
      ).to.be.revertedWithCustomError(agentGuard, "WrongStatus");
    });

    // FIX #14: Original test used pendingRequestFixture → silverAgentFixture.
    // Silver pendingLimit = 3, so a single pending request does NOT fill the cap.
    // The test asserts the second createSpendRequest reverts with ExceedsPendingLimit,
    // but it won't because silver allows 3 concurrent pending requests.
    // Fix: use bronzePendingRequestFixture (Bronze cap = 1), so 1 pending fills the slot.
    it("cancellation frees pending slot for new request", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(bronzePendingRequestFixture);

      // Bronze cap is 1 — slot is full, second request must be rejected
      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "Second")
      ).to.be.revertedWithCustomError(agentGuard, "ExceedsPendingLimit");

      // Cancel frees the slot
      await agentGuard.connect(agentOwner).cancelSpendRequest(requestId);

      // Now a new request should succeed
      await expect(
        agentGuard
          .connect(agentOwner)
          .createSpendRequest(agentOwner.address, ethers.parseEther("0.05"), "Second")
      ).to.not.be.reverted;
    });
  });

  // ── 10. Spend request execution ────────────────────────────────────────────
  describe("10. Spend request execution", function () {
    it("agent owner executes approved request and receives ETH", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);
      const amount = ethers.parseEther("0.5");

      const balanceBefore = await ethers.provider.getBalance(agentOwner.address);

      const tx = await agentGuard
        .connect(agentOwner)
        .executeSpendRequest(agentOwner.address, requestId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(agentOwner.address);
      expect(balanceAfter).to.equal(balanceBefore + amount - gasUsed);
    });

    // FIX #15: anyValue for timestamp arg.
    it("emits SpendExecuted with correct remaining treasury", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);
      const contractAddress = await agentGuard.getAddress();
      const amount = ethers.parseEther("0.5");
      const totalBalance = await ethers.provider.getBalance(contractAddress);

      await expect(
        agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId)
      )
        .to.emit(agentGuard, "SpendExecuted")
        .withArgs(
          requestId,
          agentOwner.address,
          amount,
          totalBalance - amount,  // remaining treasury after transfer
          anyValue                 // block.timestamp of the mined tx
        );
    });

    it("updates totalReleasedWei correctly", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);

      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId);

      const summary = await agentGuard.getAgentSummary(agentOwner.address);
      expect(summary.totalReleasedWei).to.equal(ethers.parseEther("0.5"));
    });

    it("request status becomes Executed", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);

      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId);

      const req = await agentGuard.getSpendRequest(requestId);
      expect(req.status).to.equal(RequestStatus.Executed);
    });

    it("execution releases escrow so subsequent approvals can proceed", async function () {
      const { agentGuard, owner, agentOwner } = await loadFixture(silverAgentFixture);
      const amount = ethers.parseEther("0.5");

      // Create and approve two requests in sequence
      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, amount, "First");
      await agentGuard.connect(owner).approveSpendRequest(0n);

      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, amount, "Second");
      await agentGuard.connect(owner).approveSpendRequest(1n);

      // Execute first — releases escrow
      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, 0n);

      // Third request and approval should succeed
      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, amount, "Third");
      await expect(
        agentGuard.connect(owner).approveSpendRequest(2n)
      ).to.not.be.reverted;
    });

    it("only agent owner can execute", async function () {
      const { agentGuard, stranger, agentOwner, requestId } = await loadFixture(
        approvedRequestFixture
      );

      await expect(
        agentGuard.connect(stranger).executeSpendRequest(agentOwner.address, requestId)
      ).to.be.revertedWithCustomError(agentGuard, "NotAgentOwner");
    });

    it("cannot execute a pending (unapproved) request", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(pendingRequestFixture);

      await expect(
        agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId)
      ).to.be.revertedWithCustomError(agentGuard, "WrongStatus")
        .withArgs(requestId, RequestStatus.Pending, RequestStatus.Approved);
    });

    it("cannot execute the same request twice", async function () {
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);

      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId);

      await expect(
        agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId)
      ).to.be.revertedWithCustomError(agentGuard, "WrongStatus")
        .withArgs(requestId, RequestStatus.Executed, RequestStatus.Approved);
    });

    it("reverts if requestId belongs to a different agent", async function () {
      const { agentGuard, owner, agentOwner, agentOwner2 } = await loadFixture(
        silverAgentFixture
      );
      await agentGuard.connect(agentOwner2).registerAgent("Agent2");
      await recordTasks(agentGuard, agentOwner2, 10, 80);

      // agentOwner creates + gets approved
      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Agent1 request");
      await agentGuard.connect(owner).approveSpendRequest(0n);

      // agentOwner2 tries to execute agentOwner's request ID
      await expect(
        agentGuard.connect(agentOwner2).executeSpendRequest(agentOwner2.address, 0n)
      ).to.be.revertedWithCustomError(agentGuard, "NotRequestAgent");
    });
  });

  // ── 11. View helpers ───────────────────────────────────────────────────────
  describe("11. View helpers", function () {
    it("getAgentSummary returns all required dashboard fields", async function () {
      const { agentGuard, agentOwner } = await loadFixture(silverAgentFixture);
      const summary = await agentGuard.getAgentSummary(agentOwner.address);

      expect(summary.owner).to.equal(agentOwner.address);
      expect(summary.name).to.equal("AlphaAgent");
      expect(summary.completedTasks).to.equal(10n);
      expect(summary.averageScore).to.equal(80n);
      expect(summary.credentialLevel).to.equal(CredentialLevel.Silver);
      expect(summary.spendLimit).to.equal(ethers.parseEther("1"));
      expect(summary.pendingLimit).to.equal(3n);
      expect(summary.availableTreasury).to.equal(ethers.parseEther("10"));
    });

    it("getAgentSummary reverts for unregistered address", async function () {
      const { agentGuard, stranger } = await loadFixture(deployFixture);

      await expect(
        agentGuard.getAgentSummary(stranger.address)
      ).to.be.revertedWithCustomError(agentGuard, "AgentNotRegistered");
    });

    it("getPendingRequests tracks additions and removals", async function () {
      const { agentGuard, owner, agentOwner } = await loadFixture(silverAgentFixture);

      expect((await agentGuard.getPendingRequests(agentOwner.address)).length).to.equal(0);

      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Req1");
      expect((await agentGuard.getPendingRequests(agentOwner.address)).length).to.equal(1);

      await agentGuard.connect(owner).approveSpendRequest(0n);
      expect((await agentGuard.getPendingRequests(agentOwner.address)).length).to.equal(0);
    });

    it("getApprovedRequests tracks additions and removals", async function () {
      const { agentGuard, owner, agentOwner } = await loadFixture(silverAgentFixture);

      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Req1");

      expect((await agentGuard.getApprovedRequests(agentOwner.address)).length).to.equal(0);

      await agentGuard.connect(owner).approveSpendRequest(0n);
      expect((await agentGuard.getApprovedRequests(agentOwner.address)).length).to.equal(1);

      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, 0n);
      expect((await agentGuard.getApprovedRequests(agentOwner.address)).length).to.equal(0);
    });

    it("getAgentRequests returns full history including executed requests", async function () {
      const { agentGuard, owner, agentOwner } = await loadFixture(silverAgentFixture);

      await agentGuard
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.5"), "Req1");
      await agentGuard.connect(owner).approveSpendRequest(0n);
      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, 0n);

      const history = await agentGuard.getAgentRequests(agentOwner.address);
      expect(history.length).to.equal(1);
      expect(history[0]).to.equal(0n);
    });

    it("getCredentials returns all credentials in insertion order", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await agentGuard.recordTaskCredential(
        agentOwner.address, "t1", TaskType.TreasuryAnalysis, 70, evidenceHash("t1")
      );
      await agentGuard.recordTaskCredential(
        agentOwner.address, "t2", TaskType.GovernanceReview, 85, evidenceHash("t2")
      );

      const creds = await agentGuard.getCredentials(agentOwner.address);
      expect(creds.length).to.equal(2);
      expect(creds[0].taskId).to.equal("t1");
      expect(creds[0].score).to.equal(70n);
      expect(creds[1].taskId).to.equal("t2");
      expect(creds[1].score).to.equal(85n);
    });

    it("getAgentAverageScore returns 0 for agent with no tasks", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);
      expect(await agentGuard.getAgentAverageScore(agentOwner.address)).to.equal(0n);
    });

    // FIX #16: Same Gold threshold math error as #7.
    // 3 tasks @80 + 7 tasks @80 = 10 tasks @80 → Silver ✓
    // 15 tasks @95 → total 25 tasks, avg = (10*80 + 15*95)/25 = 2225/25 = 89 < 90 → NOT Gold!
    // Fix: use score 95 for ALL tasks from the start so avg = 95 ≥ 90 for Gold.
    it("getAgentPendingLimit reflects credential level accurately", async function () {
      const { agentGuard, agentOwner } = await loadFixture(deployFixture);
      await agentGuard.connect(agentOwner).registerAgent("A");

      // None → 0
      expect(await agentGuard.getAgentPendingLimit(agentOwner.address)).to.equal(0n);

      // Bronze (3 tasks @ 95): avg=95 ≥ 60, count=3 ≥ 3 → Bronze ✓
      await recordTasks(agentGuard, agentOwner, 3, 95);
      expect(await agentGuard.getAgentPendingLimit(agentOwner.address)).to.equal(1n);

      // Silver (10 tasks total @ 95): avg=95 ≥ 75, count=10 ≥ 10 → Silver ✓
      await recordTasks(agentGuard, agentOwner, 7, 95, 3);
      expect(await agentGuard.getAgentPendingLimit(agentOwner.address)).to.equal(3n);

      // Gold (25 tasks total @ 95): avg=95 ≥ 90, count=25 ≥ 25 → Gold ✓
      await recordTasks(agentGuard, agentOwner, 15, 95, 10);
      expect(await agentGuard.getAgentPendingLimit(agentOwner.address)).to.equal(5n);
    });
  });

  // ── 12. Access control ─────────────────────────────────────────────────────
  describe("12. Access control", function () {
    it("owner can transfer ownership", async function () {
      const { agentGuard, owner, stranger } = await loadFixture(deployFixture);

      await agentGuard.connect(owner).transferOwnership(stranger.address);
      expect(await agentGuard.owner()).to.equal(stranger.address);
    });

    it("old owner cannot call onlyOwner functions after transfer", async function () {
      const { agentGuard, owner, stranger, agentOwner } = await loadFixture(
        registeredAgentFixture
      );

      await agentGuard.connect(owner).transferOwnership(stranger.address);

      await expect(
        agentGuard
          .connect(owner)
          .recordTaskCredential(
            agentOwner.address,
            "task-001",
            TaskType.TreasuryAnalysis,
            80,
            evidenceHash("task-001")
          )
      ).to.be.revertedWithCustomError(agentGuard, "OwnableUnauthorizedAccount");
    });

    it("view functions revert for unregistered agents", async function () {
      const { agentGuard, stranger } = await loadFixture(deployFixture);

      await expect(
        agentGuard.getAgentSummary(stranger.address)
      ).to.be.revertedWithCustomError(agentGuard, "AgentNotRegistered");

      await expect(
        agentGuard.getCredentials(stranger.address)
      ).to.be.revertedWithCustomError(agentGuard, "AgentNotRegistered");

      await expect(
        agentGuard.getAgentRequests(stranger.address)
      ).to.be.revertedWithCustomError(agentGuard, "AgentNotRegistered");
    });
  });

  // ── 13. Edge cases & attack vectors ───────────────────────────────────────
  describe("13. Edge cases & attack vectors", function () {
    // FIX #17: The original test had two phases:
    //   Phase 1 (ag): 7 ETH treasury, two 4 ETH requests.
    //     - approveSpendRequest(0n): escrow=4, avail=3 ✓
    //     - approveSpendRequest(1n): 4 ETH > 3 ETH available → REVERTS unhandled
    //   This crash prevented Phase 2 (ag2) from running at all.
    //
    // Fix: Remove Phase 1 entirely. Phase 2 (ag2) already cleanly demonstrates
    // the escrow accounting invariant: 5 ETH treasury, approve 4 ETH (avail=1),
    // then try to approve 2 ETH → InsufficientAvailableFunds ✓
    it("multiple approvals cannot over-commit treasury (escrow accounting)", async function () {
      const { owner, agentOwner } = await loadFixture(deployFixture);

      const AgentGuard = await ethers.getContractFactory("AgentGuard");
      const ag = await AgentGuard.deploy();
      await ag.waitForDeployment();

      // Treasury: 5 ETH
      await ag.connect(owner).depositTreasury({ value: ethers.parseEther("5") });
      await ag.connect(agentOwner).registerAgent("GoldAgent");
      // 25 tasks @ 95 → Gold (avg=95 ≥ 90, count=25 ≥ 25) ✓
      await recordTasks(ag, agentOwner, 25, 95);

      // Approve 4 ETH → escrowed=4, available=1
      await ag
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("4"), "Req1");
      await ag.connect(owner).approveSpendRequest(0n);

      expect(await ag.availableTreasury()).to.equal(ethers.parseEther("1"));

      // Request 2 ETH — within Gold limit but exceeds available (1 ETH)
      await ag
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("2"), "Req2");

      // 2 ETH > 1 ETH available → must revert
      await expect(
        ag.connect(owner).approveSpendRequest(1n)
      ).to.be.revertedWithCustomError(ag, "InsufficientAvailableFunds")
        .withArgs(ethers.parseEther("2"), ethers.parseEther("1"));
    });

    it("reentrancy: executeSpendRequest is protected", async function () {
      // This test verifies nonReentrant is in place by confirming double-execute fails.
      // A full reentrancy attack requires a malicious contract — here we verify
      // the state machine prevents double-execution (which is what nonReentrant protects).
      const { agentGuard, agentOwner, requestId } = await loadFixture(approvedRequestFixture);

      await agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId);

      // Second call must revert — status is now Executed
      await expect(
        agentGuard.connect(agentOwner).executeSpendRequest(agentOwner.address, requestId)
      ).to.be.revertedWithCustomError(agentGuard, "WrongStatus");
    });

    it("credential level cannot be manually assigned", async function () {
      // AgentGuard exposes no setCredentialLevel or increaseReputation function.
      // Verify the ABI does not contain such methods.
      const { agentGuard } = await loadFixture(deployFixture);
      expect(agentGuard.setCredentialLevel).to.be.undefined;
      expect(agentGuard.increaseReputation).to.be.undefined;
      expect(agentGuard.upgradeCredential).to.be.undefined;
    });

    it("agentAtIndex reverts for out-of-bounds index", async function () {
      const { agentGuard } = await loadFixture(deployFixture);

      await expect(agentGuard.agentAtIndex(0n)).to.be.reverted;
    });

    it("getCredentialAt reverts for out-of-bounds index", async function () {
      const { agentGuard, agentOwner } = await loadFixture(registeredAgentFixture);

      await expect(agentGuard.getCredentialAt(agentOwner.address, 0n)).to.be.reverted;
    });

    it("full lifecycle: register → credential → spend request → approve → execute", async function () {
      // Comprehensive end-to-end flow
      const [owner, agentOwner] = await ethers.getSigners();
      const AgentGuard = await ethers.getContractFactory("AgentGuard");
      const ag = await AgentGuard.deploy();
      await ag.waitForDeployment();

      // 1. Fund treasury
      await ag.connect(owner).depositTreasury({ value: ethers.parseEther("5") });
      expect(await ag.availableTreasury()).to.equal(ethers.parseEther("5"));

      // 2. Register agent
      await ag.connect(agentOwner).registerAgent("FullFlowAgent");
      expect(await ag.isRegistered(agentOwner.address)).to.be.true;

      // 3. Build Silver credentials
      for (let i = 0; i < 10; i++) {
        const tId = `flow-task-${i}`;
        await ag.recordTaskCredential(
          agentOwner.address, tId, TaskType.GovernanceReview, 80, evidenceHash(tId)
        );
      }

      const summary = await ag.getAgentSummary(agentOwner.address);
      expect(summary.credentialLevel).to.equal(CredentialLevel.Silver);
      expect(summary.averageScore).to.equal(80n);

      // 4. Create spend request
      await ag
        .connect(agentOwner)
        .createSpendRequest(agentOwner.address, ethers.parseEther("0.75"), "Q3 tooling budget");

      expect((await ag.getPendingRequests(agentOwner.address)).length).to.equal(1);

      // 5. Approve
      await ag.connect(owner).approveSpendRequest(0n);

      expect((await ag.getPendingRequests(agentOwner.address)).length).to.equal(0);
      expect((await ag.getApprovedRequests(agentOwner.address)).length).to.equal(1);
      expect(await ag.availableTreasury()).to.equal(
        ethers.parseEther("5") - ethers.parseEther("0.75")
      );

      // 6. Execute
      const balBefore = await ethers.provider.getBalance(agentOwner.address);
      const tx = await ag.connect(agentOwner).executeSpendRequest(agentOwner.address, 0n);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(agentOwner.address);

      expect(balAfter).to.equal(balBefore + ethers.parseEther("0.75") - gasUsed);
      expect((await ag.getApprovedRequests(agentOwner.address)).length).to.equal(0);

      const req = await ag.getSpendRequest(0n);
      expect(req.status).to.equal(RequestStatus.Executed);

      const finalSummary = await ag.getAgentSummary(agentOwner.address);
      expect(finalSummary.totalReleasedWei).to.equal(ethers.parseEther("0.75"));
    });
  });
});