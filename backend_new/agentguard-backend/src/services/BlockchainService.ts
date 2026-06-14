import { ethers } from "ethers";
import { config } from "../config/index.js";
import type { EvidencePackage, Task, TaskType } from "../models/index.js";

// ─── Minimal ABI — only the functions the backend calls ──────────────────────
//
// Derived directly from AgentGuard v1.0 source. Private state is accessed only
// through the public view functions the contract exposes; no direct mapping
// accessors are used.

const AGENTGUARD_ABI = [
  // ── Write ──────────────────────────────────────────────────────────────────

  // Matches: recordTaskCredential(address, string, TaskType, uint256, bytes32)
  // onlyOwner. Credential level derived automatically by contract.
  "function recordTaskCredential(address agent, string calldata taskId, uint8 taskType, uint256 score, bytes32 evidenceHash) external",

  // Matches: depositTreasury() payable onlyOwner
  "function depositTreasury() external payable",

  // Matches: createSpendRequest(address agentAddress, uint256 amount, string purpose)
  // msg.sender must be _agents[agentAddress].owner
  "function createSpendRequest(address agentAddress, uint256 amount, string calldata purpose) external returns (uint256 requestId)",

  // Matches: approveSpendRequest(uint256 requestId) onlyOwner
  "function approveSpendRequest(uint256 requestId) external",

  // Matches: rejectSpendRequest(uint256 requestId, string reason) onlyOwner
  "function rejectSpendRequest(uint256 requestId, string calldata reason) external",

  // Matches: cancelSpendRequest(uint256 requestId)
  // Pending: agent owner or protocol owner. Approved: protocol owner only.
  "function cancelSpendRequest(uint256 requestId) external",

  // Matches: executeSpendRequest(address agentAddress, uint256 requestId)
  // nonReentrant, onlyAgentOwner — transfers ETH to agentAddress
  "function executeSpendRequest(address agentAddress, uint256 requestId) external",

  // ── Read: treasury ─────────────────────────────────────────────────────────

  // Matches: availableTreasury() — balance minus escrowed approved requests
  "function availableTreasury() external view returns (uint256)",

  // ── Read: agent ────────────────────────────────────────────────────────────

  // Matches: getAgent(address) returns (owner, name, completedTasks, averageScore,
  //          credentialLevel, totalReleasedWei, pendingCount)
  "function getAgent(address agent) external view returns (address agentOwner, string memory name, uint256 completedTasks, uint256 averageScore, uint8 credentialLevel, uint256 totalReleasedWei, uint256 pendingCount)",

  // Matches: getAgentSummary(address) returns (AgentSummary)
  // "function getAgentSummary(address agent) external view returns (address owner, string memory name, uint256 completedTasks, uint256 averageScore, uint8 credentialLevel, uint256 totalReleasedWei, uint256 pendingCount, uint256 spendLimit, uint256 pendingLimit, uint256 availableTreasury)",

  "function getAgentSummary(address agent) external view returns ((address owner,string name,uint256 completedTasks,uint256 averageScore,uint8 credentialLevel,uint256 totalReleasedWei,uint256 pendingCount,uint256 spendLimit,uint256 pendingLimit,uint256 availableTreasury) summary)",

  // ── Read: credentials ──────────────────────────────────────────────────────

  // Matches: getCredentialAt(address agent, uint256 index) returns (TaskCredential)
  "function getCredentialAt(address agent, uint256 index) external view returns (string memory taskId, uint8 taskType, uint256 score, bytes32 evidenceHash, uint256 timestamp)",

  // ── Read: spend requests ───────────────────────────────────────────────────

  // Matches: getSpendRequest(uint256 requestId) returns (SpendRequest)
  // RequestStatus enum: Pending=0, Approved=1, Executed=2, Rejected=3, Cancelled=4
  // "function getSpendRequest(uint256 requestId) external view returns (uint256 requestId_, address agent, uint256 amount, string memory purpose, uint256 timestamp, uint8 status, string memory rejectionReason, bool exists)",

  "function getSpendRequest(uint256 requestId) external view returns ((uint256 requestId,address agent,uint256 amount,string purpose,uint256 timestamp,uint8 status,string rejectionReason,bool exists) request)",

  // Matches: totalAgents() — used for registry enumeration
  "function totalAgents() external view returns (uint256)",

  // ── Events ─────────────────────────────────────────────────────────────────

  // The event actually emitted by recordTaskCredential().
  // Note: no credentialId is emitted. Credential identity is (agent, taskId).
  "event TaskCredentialRecorded(address indexed agent, string indexed taskId, uint8 taskType, uint256 score, bytes32 evidenceHash, uint256 newAverageScore, uint256 completedTasks, uint256 timestamp)",
  "event SpendRequestCreated(uint256 indexed requestId, address indexed agent, uint256 amount, string purpose, uint256 timestamp)",
  "event SpendRequestApproved(uint256 indexed requestId, address indexed agent, uint256 amount, uint256 timestamp)",
  "event SpendRequestRejected(uint256 indexed requestId, address indexed agent, string reason, uint256 timestamp)",
  "event SpendRequestCancelled(uint256 indexed requestId, address indexed agent, address cancelledBy, uint256 timestamp)",
  "event SpendExecuted(uint256 indexed requestId, address indexed agent, uint256 amount, uint256 remainingTreasury, uint256 timestamp)",
  "event TreasuryDeposited(address indexed depositor, uint256 amount, uint256 newBalance)",
] as const;

// ─── TaskType → contract enum uint8 ──────────────────────────────────────────
//
// The contract defines: enum TaskType { TreasuryAnalysis, GovernanceReview, RiskAssessment }
// ABI encoding passes uint8: 0, 1, 2 respectively.

const TASK_TYPE_ENUM: Record<TaskType, number> = {
  TreasuryAnalysis: 0,
  GovernanceReview: 1,
  RiskAssessment: 2,
};

// ─── RequestStatus → string label ────────────────────────────────────────────
//
// Matches: enum RequestStatus { Pending, Approved, Executed, Rejected, Cancelled }

const REQUEST_STATUS_LABEL: Record<number, string> = {
  0: "Pending",
  1: "Approved",
  2: "Executed",
  3: "Rejected",
  4: "Cancelled",
};

// ─── CredentialLevel → string label ──────────────────────────────────────────
//
// Matches: enum CredentialLevel { None, Bronze, Silver, Gold }

const CREDENTIAL_LEVEL_LABEL: Record<number, string> = {
  0: "None",
  1: "Bronze",
  2: "Silver",
  3: "Gold",
};

// ─── Exported interfaces ──────────────────────────────────────────────────────

/** Shape returned by readAgent(). Mirrors getAgent() return values exactly. */
export interface OnchainAgent {
  owner: string;
  name: string;
  completedTasks: number;
  averageScore: number;
  credentialLevel: number;           // 0=None 1=Bronze 2=Silver 3=Gold
  credentialLevelLabel: string;      // human-readable label
  totalReleasedWei: bigint;
  pendingCount: number;
}

/** Full dashboard summary from getAgentSummary(). */
export interface OnchainAgentSummary extends OnchainAgent {
  spendLimit: bigint;
  pendingLimit: number;
  availableTreasury: bigint;
}

/** Shape returned by readSpendRequest(). Mirrors SpendRequest struct exactly. */
export interface OnchainSpendRequest {
  requestId: number;
  agent: string;
  amount: bigint;
  purpose: string;
  timestamp: number;
  status: number;                    // 0-4 matching RequestStatus enum
  statusLabel: string;               // human-readable label
  rejectionReason: string;
  exists: boolean;
}

/** Shape returned by readCredential(). Mirrors TaskCredential struct exactly. */
export interface OnchainCredential {
  taskId: string;
  taskType: number;
  score: number;
  evidenceHash: string;
  timestamp: number;
}

/**
 * What BlockchainService returns after a successful recordTaskCredential() call.
 *
 * Note: the contract emits TaskCredentialRecorded, not CredentialRecorded.
 * There is no credentialId in the event — the credential is identified by
 * (agent, taskId) and retrievable by index via getCredentialAt().
 * completedTasks is the agent's new total, emitted by the event.
 */
export interface CredentialReceipt {
  txHash: string;
  blockNumber: number;
  /** The task ID echoed from the event (confirms the correct task was recorded). */
  confirmedTaskId: string;
  /** Agent's new completedTasks count, emitted by TaskCredentialRecorded. */
  completedTasks: number;
  /** Agent's new average score, emitted by TaskCredentialRecorded. */
  newAverageScore: number;
}

// ─── BlockchainService ────────────────────────────────────────────────────────

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private contract: ethers.Contract;
  private iface: ethers.Interface;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
    this.signer = new ethers.Wallet(config.blockchain.privateKey, this.provider);
    this.contract = new ethers.Contract(
      config.blockchain.contractAddress,
      AGENTGUARD_ABI,
      this.signer
    );
    // Build interface once for event parsing
    this.iface = new ethers.Interface(AGENTGUARD_ABI);
  }

  /**
   * Submit a task credential onchain.
   *
   * Calls recordTaskCredential(agent, taskId, taskType, score, evidenceHash).
   * Credential level is NOT sent — the contract derives it automatically from
   * the agent's cumulative task history and rolling average score.
   *
   * Parses the TaskCredentialRecorded event from the receipt to confirm
   * the submission and extract the agent's updated stats.
   */
  async recordTaskCredential(
    agentAddress: string,
    evidence: EvidencePackage,
    task: Task
  ): Promise<CredentialReceipt> {
    const taskTypeUint8 = TASK_TYPE_ENUM[task.taskType];

    console.log(`[BlockchainService] Recording credential for agent ${agentAddress}`);
    console.log(`  task:     ${task.id} (${task.taskType} → uint8 ${taskTypeUint8})`);
    console.log(`  score:    ${evidence.metadata.score}`);
    console.log(`  hash:     ${evidence.evidenceHash}`);
    console.log(`  note:     credential level derived by contract, not backend`);

    const tx = await (this.contract as any).recordTaskCredential(
      agentAddress,                  // address agent
      task.id,                       // string taskId  — must be unique per agent
      taskTypeUint8,                 // uint8 taskType — enum index
      evidence.metadata.score,       // uint256 score
      evidence.evidenceHash          // bytes32 evidenceHash
    );

    console.log(`[BlockchainService] Tx submitted: ${tx.hash}`);

    const receipt = await tx.wait(1);

    // ── Parse TaskCredentialRecorded event ────────────────────────────────────
    // Signature: TaskCredentialRecorded(address indexed agent, string indexed taskId,
    //   uint8 taskType, uint256 score, bytes32 evidenceHash,
    //   uint256 newAverageScore, uint256 completedTasks, uint256 timestamp)
    //
    // Note: string indexed fields are keccak256-hashed in topics and cannot be
    // decoded back to the original string. We use non-indexed fields for data.

    let confirmedTaskId = task.id; // fallback: trust what we sent
    let completedTasks = 0;
    let newAverageScore = 0;

    for (const log of receipt.logs) {
      try {
        const parsed = this.iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "TaskCredentialRecorded") {
          // args order: agent, taskId(hashed-topic), taskType, score, evidenceHash,
          //             newAverageScore, completedTasks, timestamp
          // Non-indexed args decoded from data:
          completedTasks = Number(parsed.args.completedTasks);
          newAverageScore = Number(parsed.args.newAverageScore);
          // taskId is indexed so it arrives as a keccak256 hash in topics — we
          // cannot reverse it, so we keep the value we submitted as confirmation.
          break;
        }
      } catch {
        // Logs from other contracts (e.g. OpenZeppelin Ownable) are skipped silently
      }
    }

    console.log(`[BlockchainService] Confirmed in block ${receipt.blockNumber}`);
    console.log(`  completedTasks:  ${completedTasks}`);
    console.log(`  newAverageScore: ${newAverageScore}`);

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      confirmedTaskId,
      completedTasks,
      newAverageScore,
    };
  }

  /**
   * Read an agent's current state via getAgent().
   * Returns null if the agent is not registered or the call fails.
   */
  async readAgent(address: string): Promise<OnchainAgent | null> {
    try {
      const normalized = ethers.getAddress(address);
      const r = await (this.contract as any).getAgent(normalized);
      // Return tuple: (agentOwner, name, completedTasks, averageScore,
      //               credentialLevel, totalReleasedWei, pendingCount)
      return {
        owner: r[0],
        name: r[1],
        completedTasks: Number(r[2]),
        averageScore: Number(r[3]),
        credentialLevel: Number(r[4]),
        credentialLevelLabel: CREDENTIAL_LEVEL_LABEL[Number(r[4])] ?? "Unknown",
        totalReleasedWei: r[5],
        pendingCount: Number(r[6]),
      };
    } catch (err) {
      console.error("[BlockchainService] readAgent error:", err);
      return null;
    }
  }

  /**
   * Read full agent summary (includes spend limits and treasury context).
   * Returns null if the agent is not registered or the call fails.
   */
  async readAgentSummary(address: string): Promise<OnchainAgentSummary | null> {
    try {
      const normalized = ethers.getAddress(address);
      const r = await (this.contract as any).getAgentSummary(normalized);
      // Struct fields in order: owner, name, completedTasks, averageScore,
      // credentialLevel, totalReleasedWei, pendingCount, spendLimit, pendingLimit, availableTreasury
      return {
        owner: r[0],
        name: r[1],
        completedTasks: Number(r[2]),
        averageScore: Number(r[3]),
        credentialLevel: Number(r[4]),
        credentialLevelLabel: CREDENTIAL_LEVEL_LABEL[Number(r[4])] ?? "Unknown",
        totalReleasedWei: r[5],
        pendingCount: Number(r[6]),
        spendLimit: r[7],
        pendingLimit: Number(r[8]),
        availableTreasury: r[9],
      };

      // const normalized = ethers.getAddress(address);

      // const data = this.contract.interface.encodeFunctionData(
      //   "getAgentSummary",
      //   [normalized]
      // );

      // const raw = await this.provider.call({
      //   to: config.blockchain.contractAddress,
      //   data,
      // });

      // console.log("RAW SUMMARY:", raw);
    } catch (err) {
      console.error("[BlockchainService] readAgentSummary error:", err);
      return null;
    }
  }

  /**
   * Read a spend request by ID via getSpendRequest().
   * Returns null if the request does not exist or the call fails.
   *
   * The contract reverts with RequestNotFound if !req.exists, so we catch
   * and return null rather than propagating.
   */
  async readSpendRequest(requestId: number): Promise<OnchainSpendRequest | null> {
    try {
      const r = await (this.contract as any).getSpendRequest(requestId);
      // Struct fields: requestId_, agent, amount, purpose, timestamp,
      //                status, rejectionReason, exists
      if (!r[7]) return null; // exists == false

      return {
        requestId: Number(r[0]),
        agent: r[1],
        amount: r[2],
        purpose: r[3],
        timestamp: Number(r[4]),
        status: Number(r[5]),
        statusLabel: REQUEST_STATUS_LABEL[Number(r[5])] ?? "Unknown",
        rejectionReason: r[6],
        exists: r[7],
      };
    } catch (err) {
      // Contract reverts with RequestNotFound for non-existent IDs —
      // treat as null rather than an application error.
      console.error(`[BlockchainService] readSpendRequest(${requestId}) error:`, err);
      return null;
    }
  }

  /**
   * Read all spend requests from requestId 0 upward.
   * Stops when a request does not exist (contract revert or exists=false).
   *
   * The contract uses a monotonically increasing _nextRequestId, so IDs are
   * contiguous from 0. We stop at the first gap rather than a fixed ceiling.
   */
  async readAllSpendRequests(maxId = 100): Promise<OnchainSpendRequest[]> {
    const results: OnchainSpendRequest[] = [];
    for (let i = 0; i < maxId; i++) {
      const req = await this.readSpendRequest(i);
      if (!req) break; // exists=false or contract revert → no more requests
      results.push(req);
    }
    return results;
  }

  /**
   * Read a credential by agent address and array index via getCredentialAt().
   * Returns null if out of bounds or the call fails.
   */
  async readCredential(
    agentAddress: string,
    index: number
  ): Promise<OnchainCredential | null> {
    try {
      const normalized = ethers.getAddress(agentAddress);
      const r = await (this.contract as any).getCredentialAt(normalized, index);
      // TaskCredential struct: taskId, taskType, score, evidenceHash, timestamp
      return {
        taskId: r[0],
        taskType: Number(r[1]),
        score: Number(r[2]),
        evidenceHash: r[3],
        timestamp: Number(r[4]),
      };
    } catch (err) {
      console.error(`[BlockchainService] readCredential(${agentAddress}, ${index}) error:`, err);
      return null;
    }
  }


  // ── Treasury write methods ──────────────────────────────────────────────────

  /**
   * Deposit ETH into the contract treasury.
   * Caller must be the contract owner (the backend signer).
   * amountWei must be a string representation of the wei value.
   */
  async depositTreasury(amountWei: string): Promise<{ txHash: string; blockNumber: number; newBalance: string }> {
    console.log(`[BlockchainService] depositTreasury ${ethers.formatEther(amountWei)} ETH`);
    const tx = await (this.contract as any).depositTreasury({ value: BigInt(amountWei) });
    console.log(`[BlockchainService] Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait(1);
    const newBalance = await this.provider.getBalance(config.blockchain.contractAddress);
    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      newBalance: newBalance.toString(),
    };
  }

  /**
   * Create a spend request on behalf of a registered agent.
   * msg.sender (the signer) must be _agents[agentAddress].owner.
   * amountWei must be a string representation of the wei value.
   */
  async createSpendRequest(
    agentAddress: string,
    amountWei: string,
    purpose: string
  ): Promise<{ txHash: string; blockNumber: number; requestId: number }> {
    const normalized = ethers.getAddress(agentAddress);
    console.log(`[BlockchainService] createSpendRequest agent=${normalized} amount=${ethers.formatEther(amountWei)} ETH`);
    const tx = await (this.contract as any).createSpendRequest(normalized, BigInt(amountWei), purpose);
    console.log(`[BlockchainService] Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait(1);
    // Parse SpendRequestCreated(requestId, agent, amount, purpose, timestamp)
    const iface = this.iface;
    let requestId = -1;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "SpendRequestCreated") {
          requestId = Number(parsed.args[0]);
          break;
        }
      } catch { /* skip */ }
    }
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, requestId };
  }

  /**
   * Approve a pending spend request.
   * Caller must be the contract owner.
   */
  async approveSpendRequest(requestId: number): Promise<{ txHash: string; blockNumber: number }> {
    console.log(`[BlockchainService] approveSpendRequest #${requestId}`);
    const tx = await (this.contract as any).approveSpendRequest(requestId);
    const receipt = await tx.wait(1);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /**
   * Reject a pending spend request with a mandatory reason.
   * Caller must be the contract owner.
   */
  async rejectSpendRequest(requestId: number, reason: string): Promise<{ txHash: string; blockNumber: number }> {
    if (!reason.trim()) throw new Error("Rejection reason is required");
    console.log(`[BlockchainService] rejectSpendRequest #${requestId}`);
    const tx = await (this.contract as any).rejectSpendRequest(requestId, reason);
    const receipt = await tx.wait(1);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /**
   * Cancel a spend request.
   * Pending: agent owner or protocol owner may cancel.
   * Approved: protocol owner only.
   */
  async cancelSpendRequest(requestId: number): Promise<{ txHash: string; blockNumber: number }> {
    console.log(`[BlockchainService] cancelSpendRequest #${requestId}`);
    const tx = await (this.contract as any).cancelSpendRequest(requestId);
    const receipt = await tx.wait(1);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  /**
   * Execute an approved spend request, transferring ETH to the agent.
   * msg.sender must be _agents[agentAddress].owner.
   * Uses checks-effects-interactions on the contract side.
   */
  async executeSpendRequest(
    agentAddress: string,
    requestId: number
  ): Promise<{ txHash: string; blockNumber: number; amountWei: string }> {
    const normalized = ethers.getAddress(agentAddress);
    console.log(`[BlockchainService] executeSpendRequest agent=${normalized} requestId=#${requestId}`);
    const tx = await (this.contract as any).executeSpendRequest(normalized, requestId);
    const receipt = await tx.wait(1);
    // Parse SpendExecuted(requestId, agent, amount, remainingTreasury, timestamp)
    let amountWei = "0";
    for (const log of receipt.logs) {
      try {
        const parsed = this.iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "SpendExecuted") {
          amountWei = parsed.args[2].toString();
          break;
        }
      } catch { /* skip */ }
    }
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, amountWei };
  }

  /**
   * Read the contract's ETH balances.
   * Returns: total balance, available (balance - escrow), and computed escrow.
   */
  async readTreasuryBalance(): Promise<{
    totalBalanceWei: string;
    availableWei: string;
    escrowedWei: string;
  }> {
    const [totalBalance, available] = await Promise.all([
      this.provider.getBalance(config.blockchain.contractAddress),
      (this.contract as any).availableTreasury() as Promise<bigint>,
    ]);
    const escrowed = totalBalance - available;
    return {
      totalBalanceWei: totalBalance.toString(),
      availableWei: available.toString(),
      escrowedWei: escrowed < 0n ? "0" : escrowed.toString(),
    };
  }


  /**
   * Ping the provider to confirm connectivity at startup.
   */
  async healthCheck(): Promise<{
    connected: boolean;
    blockNumber?: number;
    chainId?: string;
  }> {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      return {
        connected: true,
        blockNumber,
        chainId: network.chainId.toString(),
      };
    } catch {
      return { connected: false };
    }
  }
}

export const blockchainService = new BlockchainService();
