import { v4 as uuidv4 } from "uuid";
import { store } from "../utils/store.js";
import { agentService } from "./AgentService.js";
import { evaluationService } from "./EvaluationService.js";
import { evidenceService } from "./EvidenceService.js";
import { blockchainService } from "./BlockchainService.js";
import { spendDecisionService } from "./SpendDecisionService.js";
import type { Task, Report, CreateTaskInput } from "../models/index.js";

export class TaskService {
  createTask(input: CreateTaskInput): Task {
    const task: Task = {
      id: uuidv4(),
      title: input.title,
      description: input.description,
      taskType: input.taskType,
      status: "pending",
      createdAt: new Date().toISOString(),
      agentAddress: input.agentAddress,
    };
    store.saveTask(task);
    console.log(`[TaskService] Created task ${task.id} (${task.taskType})`);
    return task;
  }

  getTasks(): Task[] {
    return store.getAllTasks();
  }

  getTask(id: string): Task | undefined {
    return store.getTask(id);
  }

  /**
   * Execute the full agent pipeline for a task.
   *
   *   Step 1 — AgentService: LLM produces analysis + recommendation
   *   Step 2 — EvaluationService: deterministic score 0–100
   *   Step 3 — EvidenceService: keccak256(canonicalJSON) → evidenceHash
   *   Step 4 — BlockchainService: recordTaskCredential() onchain
   *   Step 5 — SpendDecisionService: agent decides on treasury request
   *            • LLM reads own output → requiresFunding, purpose, rationale
   *            • Backend computes amount from score + credential level (deterministic)
   *            • If approved: createSpendRequest() onchain (agent-originated)
   *            • Result persisted as Report.treasuryDecision regardless of outcome
   *
   * Steps 1–4 are hard failures: any error aborts and marks the task failed.
   * Step 5 is best-effort: any error is caught, recorded in treasuryDecision,
   * and the Report is still persisted as completed.
   */
  async executeTask(taskId: string, agentAddress?: string): Promise<Report> {
    const task = store.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === "running") throw new Error(`Task ${taskId} is already running`);
    if (task.status === "completed") throw new Error(`Task ${taskId} already completed`);

    const resolvedAgent = agentAddress ?? task.agentAddress;
    if (!resolvedAgent) throw new Error(`No agent address provided for task ${taskId}`);

    store.updateTask(taskId, { status: "running", agentAddress: resolvedAgent });

    try {
      // ── Step 1: Agent execution ──────────────────────────────────────────────
      console.log(`[TaskService] Step 1/5: Agent executing task ${taskId}`);
      const agentOutput = await agentService.execute(task);

      // ── Step 2: Evaluation ───────────────────────────────────────────────────
      console.log(`[TaskService] Step 2/5: Evaluating output`);
      const evaluation = evaluationService.evaluate(task, agentOutput);
      console.log(`  Score: ${evaluation.score}/100  breakdown: completeness=${evaluation.breakdown.completeness} structural=${evaluation.breakdown.structuralQuality} actionability=${evaluation.breakdown.confidenceCalibration} coherence=${evaluation.breakdown.taskTypeCoherence}`);

      // ── Step 3: Evidence generation ──────────────────────────────────────────
      console.log(`[TaskService] Step 3/5: Generating evidence`);
      const evidence = evidenceService.generate(task, agentOutput, evaluation, resolvedAgent);
      console.log(`  evidenceHash: ${evidence.evidenceHash}`);
      if (!evidenceService.verify(evidence)) {
        throw new Error("Evidence self-verification failed — hash mismatch. Aborting onchain submission.");
      }

      // ── Step 4: Onchain credential ───────────────────────────────────────────
      console.log(`[TaskService] Step 4/5: Submitting credential onchain`);
      const receipt = await blockchainService.recordTaskCredential(resolvedAgent, evidence, task);
      console.log(`  tx: ${receipt.txHash}  completedTasks: ${receipt.completedTasks}  avgScore: ${receipt.newAverageScore}`);

      // ── Step 5: Autonomous spend decision ────────────────────────────────────
      //
      // The credential is already on-chain. Step 5 is isolated: any error here
      // is caught and stored in treasuryDecision.skipDetail without affecting
      // the credential or the Report's "completed" status.
      //
      // We pass the credential level echoed from the receipt event so the
      // decision uses the *new* level (the task just recorded may have upgraded it).
      console.log(`[TaskService] Step 5/5: Agent spend decision`);
      const credentialLevel = receipt.newAverageScore !== undefined
        ? await this.resolveCredentialLevel(resolvedAgent)
        : 0;

      const treasuryDecision = await spendDecisionService
        .decide(
          task,
          agentOutput,
          evaluation,
          resolvedAgent,
          credentialLevel,
          {
            readAgentSummary: (addr) => blockchainService.readAgentSummary(addr).then(
              s => s ? { spendLimit: s.spendLimit, availableTreasury: s.availableTreasury } : null
            ),
            createSpendRequest: (addr, amountWei, purpose) =>
              blockchainService.createSpendRequest(addr, amountWei, purpose),
          }
        )
        .catch(err => {
          // Defensive catch: SpendDecisionService should not throw, but if it does
          // we record the error and proceed.
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[TaskService] SpendDecisionService threw unexpectedly: ${msg}`);
          return {
            requiresFunding: false as const,
            rationale: "Internal error during spend decision.",
            createdByAgent: true as const,
            skipReason: "validation_failed",
            skipDetail: msg,
          };
        });

      if (treasuryDecision.requiresFunding) {
        if (treasuryDecision.spendRequestId !== undefined) {
          console.log(`  Spend request #${treasuryDecision.spendRequestId} created onchain`);
        } else {
          console.warn(`  Agent wanted to request ${treasuryDecision.amountEth} ETH but on-chain call failed: ${treasuryDecision.onchainError}`);
        }
      } else {
        console.log(`  No spend request: ${treasuryDecision.skipReason} — ${treasuryDecision.skipDetail?.slice(0, 80)}`);
      }

      // ── Build and persist Report ─────────────────────────────────────────────
      const reportId = uuidv4();
      const report: Report = {
        id: reportId,
        taskId: task.id,
        agentAddress: resolvedAgent,
        task: { ...task, status: "completed", agentAddress: resolvedAgent },
        agentOutput,
        evaluation,
        evidence,
        txHash: receipt.txHash,
        completedTasksOnchain: receipt.completedTasks,
        newAverageScoreOnchain: receipt.newAverageScore,
        treasuryDecision,
        createdAt: new Date().toISOString(),
      };

      store.saveReport(report);
      store.updateTask(taskId, { status: "completed", reportId, agentAddress: resolvedAgent });

      console.log(`[TaskService] Task ${taskId} completed. Report: ${reportId}`);
      return report;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.updateTask(taskId, { status: "failed", error: message });
      console.error(`[TaskService] Task ${taskId} failed:`, message);
      throw err;
    }
  }

  /**
   * Read the agent's current credential level from the contract.
   * Used to get the post-task level (which may have just been upgraded).
   * Returns 0 (None) on any error so the spend decision guards fire correctly.
   */
  private async resolveCredentialLevel(agentAddress: string): Promise<number> {
    try {
      const agent = await blockchainService.readAgent(agentAddress);
      return agent?.credentialLevel ?? 0;
    } catch {
      return 0;
    }
  }
}

export const taskService = new TaskService();
