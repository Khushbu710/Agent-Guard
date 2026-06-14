import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const TaskTypeSchema = z.enum([
  "TreasuryAnalysis",
  "GovernanceReview",
  "RiskAssessment",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ─── Core domain models ───────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  description: string;
  taskType: TaskType;
  status: TaskStatus;
  createdAt: string; // ISO-8601
  agentAddress?: string; // which agent executes this
  reportId?: string; // set after execution completes
  error?: string; // set if execution fails
}

export interface AgentOutput {
  analysis: string;
  recommendation: string;
  confidenceScore: number; // 0–100, produced by LLM, clamped/validated
  rawModel: string; // model identifier used
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

/**
 * EvaluationResult — deterministic scoring of an AgentOutput.
 *
 * Scoring breakdown (totals 100 points):
 *
 *  1. Completeness (30 pts)
 *     — analysis length ≥ 200 chars       → 10 pts
 *     — analysis length ≥ 500 chars       → additional 10 pts
 *     — recommendation length ≥ 100 chars → 10 pts
 *
 *  2. Structural quality (25 pts)
 *     — analysis contains ≥ 3 paragraphs  → 10 pts
 *     — recommendation contains actionable
 *       verb keywords (approve/reject/recommend/
 *       increase/decrease/monitor/review/halt)  → 15 pts
 *
 *  3. Confidence calibration (20 pts)
 *     — LLM confidence in [40, 90] range  → 10 pts (extremes indicate overfit)
 *     — |confidence - 75| < 20           → additional 10 pts (realistic zone)
 *
 *  4. Task-type coherence (25 pts)
 *     — presence of domain keywords per type:
 *       TreasuryAnalysis: liquidity, allocation, yield, risk, portfolio
 *       GovernanceReview: proposal, vote, quorum, veto, on-chain
 *       RiskAssessment:   exposure, severity, likelihood, mitigation, vector
 *     — 5 pts per keyword found, capped at 25
 */
export interface EvaluationResult {
  score: number; // 0–100, integer
  breakdown: {
    completeness: number; // 0–30
    structuralQuality: number; // 0–25
    confidenceCalibration: number; // 0–20
    taskTypeCoherence: number; // 0–25
  };
  keywordsFound: string[];
  evaluatedAt: string; // ISO-8601
}

export interface EvidencePackage {
  evidenceHash: string; // 0x-prefixed keccak256 of canonical JSON payload
  canonicalPayload: string; // the exact JSON string that was hashed
  metadata: {
    taskId: string;
    agentAddress: string;
    taskType: TaskType;
    score: number;
    timestamp: string; // ISO-8601 — included in hash for replay-safety
  };
}

/**
 * TreasuryDecision — the agent's autonomous treasury request decision.
 *
 * Always present on a Report after Step 5 runs.
 * requiresFunding=false means the agent declined or was blocked by a guard.
 *
 * Amount policy (deterministic, never LLM-determined):
 *   score >= 80 → 50% of credential spend limit
 *   score >= 60 → 30% of credential spend limit
 *   score >= 40 → 15% of credential spend limit
 *   Final amount is clamped to availableTreasury.
 *
 * Purpose and rationale are LLM-written.
 * createdByAgent is always true — distinguishes agent-originated requests
 * from human-created ones submitted via the Treasury page.
 */
export interface TreasuryDecision {
  requiresFunding: boolean;
  rationale: string;
  amountEth?: string;
  purpose?: string;
  createdByAgent: true;
  spendRequestId?: number;
  spendRequestTxHash?: string;
  skipReason?: string;
  skipDetail?: string;
  onchainError?: string;
  policy?: {
    evaluationScore: number;
    credentialLevel: number;
    spendLimitEth: string;
    availableTreasuryEth: string;
    scoreThresholdUsed: number;
    pctOfLimitUsed: number;
  };
}

export interface Report {
  id: string;
  taskId: string;
  agentAddress: string;
  task: Task;
  agentOutput: AgentOutput;
  evaluation: EvaluationResult;
  evidence: EvidencePackage;
  txHash?: string;           // set after successful onchain submission
  completedTasksOnchain?: number;
  newAverageScoreOnchain?: number;
  /** Agent's autonomous treasury decision — always present after pipeline completes. */
  treasuryDecision?: TreasuryDecision;
  createdAt: string;
}

// ─── API request/response schemas ─────────────────────────────────────────────

export const CreateTaskSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  taskType: TaskTypeSchema,
  agentAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address"),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const ExecuteTaskSchema = z.object({
  agentAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address")
    .optional(),
});
export type ExecuteTaskInput = z.infer<typeof ExecuteTaskSchema>;

// ─── LLM response schema (validated via Zod before use) ──────────────────────

export const LLMResponseSchema = z.object({
  analysis: z.string().min(50),
  recommendation: z.string().min(20),
  confidenceScore: z.number().min(0).max(100),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;
