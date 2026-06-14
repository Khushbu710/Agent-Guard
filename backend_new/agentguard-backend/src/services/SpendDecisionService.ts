import OpenAI from "openai";
import { z } from "zod";
import { ethers } from "ethers";
import { config } from "../config/index.js";
import type { Task, AgentOutput, EvaluationResult, TreasuryDecision } from "../models/index.js";

// ─── Deterministic amount policy ──────────────────────────────────────────────
//
// The LLM decides WHETHER to request funding, WHAT to say, and WHY.
// The backend decides HOW MUCH. This keeps the financial parameter out of the
// LLM's hands entirely — a model cannot inflate or deflate the amount.
//
// Policy table: score band → percentage of the agent's credential spend limit.
// The result is clamped to availableTreasury so we never request more than exists.
//
//   score >= 80  →  50%  (high-quality analysis warrants fuller allocation)
//   score >= 60  →  30%  (solid analysis, moderate request)
//   score >= 40  →  15%  (minimum threshold, conservative request)

interface AmountPolicy {
  minScore: number;
  pctOfLimit: number;  // 0–100 integer, percentage of spend limit
}

const AMOUNT_POLICY: AmountPolicy[] = [
  { minScore: 80, pctOfLimit: 50 },
  { minScore: 60, pctOfLimit: 30 },
  { minScore: 40, pctOfLimit: 15 },
];

/**
 * Compute the deterministic ETH amount for an autonomous spend request.
 *
 * Returns { amountWei, amountEth, pctUsed, thresholdUsed } or null if
 * the score is below all policy thresholds (should not happen after guard 2,
 * but defensive).
 */
function computeAmount(
  evaluationScore: number,
  spendLimitWei: bigint,
  availableTreasuryWei: bigint
): {
  amountWei: bigint;
  amountEth: string;
  pctUsed: number;
  thresholdUsed: number;
} | null {
  const tier = AMOUNT_POLICY.find(p => evaluationScore >= p.minScore);
  if (!tier) return null;

  // pct of spend limit, computed in integer wei arithmetic to avoid float drift
  const raw = (spendLimitWei * BigInt(tier.pctOfLimit)) / 100n;

  // Clamp to available treasury
  const clamped = raw < availableTreasuryWei ? raw : availableTreasuryWei;

  if (clamped <= 0n) return null;

  return {
    amountWei: clamped,
    amountEth: ethers.formatEther(clamped),
    pctUsed: tier.pctOfLimit,
    thresholdUsed: tier.minScore,
  };
}

// ─── Safety constants ─────────────────────────────────────────────────────────

const MIN_SCORE_FOR_SPEND = 40;
const PURPOSE_MIN_LENGTH = 20;
const PURPOSE_MAX_LENGTH = 300;
// Standard printable ASCII minus control chars. Allows letters, digits, spaces,
// and common punctuation safe for on-chain string storage.
const PURPOSE_SAFE_REGEX = /^[\w\s.,;:'"()\-/!?%@#&+=[\]]+$/;

// ─── LLM output schema ────────────────────────────────────────────────────────
//
// The LLM produces three fields only.
// Amount is deliberately excluded — the backend computes it deterministically.

const LLMIntentSchema = z.object({
  requiresFunding: z.boolean(),
  purpose: z.string(),
  rationale: z.string().min(10),
});
type LLMIntent = z.infer<typeof LLMIntentSchema>;

// ─── SpendDecisionService ─────────────────────────────────────────────────────

export class SpendDecisionService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });
  }

  /**
   * Run the full spend decision pipeline and return a TreasuryDecision
   * that can be persisted directly on the Report.
   *
   * Called AFTER the credential is recorded on-chain.
   * Failure here never rolls back the credential or the Report.
   *
   * Pipeline:
   *   Guard 1 — credential level >= Bronze
   *   Guard 2 — evaluation score >= MIN_SCORE_FOR_SPEND
   *   Guard 3 — fetch spend limit and treasury balance
   *   Step  4 — LLM reads own output, decides requiresFunding/purpose/rationale
   *   Step  5 — backend computes amount deterministically
   *   Guard 6 — validate purpose string
   *   Step  7 — submit on-chain, attach result
   */
  async decide(
    task: Task,
    agentOutput: AgentOutput,
    evaluation: EvaluationResult,
    agentAddress: string,
    credentialLevel: number,
    blockchainSvc: {
      readAgentSummary: (addr: string) => Promise<{
        spendLimit: bigint;
        availableTreasury: bigint;
      } | null>;
      createSpendRequest: (
        addr: string,
        amountWei: string,
        purpose: string
      ) => Promise<{ requestId: number; txHash: string; blockNumber: number }>;
    }
  ): Promise<TreasuryDecision> {
    // ── Guard 1: credential level ─────────────────────────────────────────────
    if (credentialLevel < 1) {
      return {
        requiresFunding: false,
        rationale: "Agent has no credential level. Earn Bronze status (3 tasks, avg score ≥ 60) before autonomous spend requests are permitted.",
        createdByAgent: true,
        skipReason: "no_credential",
        skipDetail: "Credential level is None (0). Minimum required: Bronze (1).",
      };
    }

    // ── Guard 2: minimum evaluation score ─────────────────────────────────────
    if (evaluation.score < MIN_SCORE_FOR_SPEND) {
      return {
        requiresFunding: false,
        rationale: `Evaluation score ${evaluation.score}/100 is below the minimum ${MIN_SCORE_FOR_SPEND} required for autonomous spend requests.`,
        createdByAgent: true,
        skipReason: "low_score",
        skipDetail: `Score ${evaluation.score} < threshold ${MIN_SCORE_FOR_SPEND}. Submit higher-quality analysis to unlock autonomous requests.`,
      };
    }

    // ── Guard 3: fetch contract state ─────────────────────────────────────────
    const summary = await blockchainSvc.readAgentSummary(agentAddress).catch(() => null);
    const spendLimitWei = summary?.spendLimit ?? 0n;
    const availableTreasuryWei = summary?.availableTreasury ?? 0n;
    const spendLimitEth = ethers.formatEther(spendLimitWei);
    const availableTreasuryEth = ethers.formatEther(availableTreasuryWei);

    console.log(`[SpendDecisionService] spend limit: ${spendLimitEth} ETH  available: ${availableTreasuryEth} ETH`);

    if (spendLimitWei === 0n) {
      return {
        requiresFunding: false,
        rationale: "Agent's spend limit is zero. This may indicate credential level is None.",
        createdByAgent: true,
        skipReason: "no_credential",
        skipDetail: "Spend limit returned as 0 ETH from contract.",
      };
    }

    if (availableTreasuryWei === 0n) {
      return {
        requiresFunding: false,
        rationale: "No ETH available in the treasury. Request deferred until funds are deposited.",
        createdByAgent: true,
        skipReason: "no_available_funds",
        skipDetail: "availableTreasury() returned 0.",
      };
    }

    // ── Step 4: LLM decides requiresFunding, purpose, rationale ──────────────
    const intent = await this.extractIntent(task, agentOutput);

    if (!intent.requiresFunding) {
      return {
        requiresFunding: false,
        rationale: intent.rationale,
        createdByAgent: true,
        skipReason: "agent_declined",
        skipDetail: `Agent determined no treasury action is required. Rationale: ${intent.rationale}`,
      };
    }

    // ── Step 5: deterministic amount ─────────────────────────────────────────
    const computed = computeAmount(evaluation.score, spendLimitWei, availableTreasuryWei);

    if (!computed) {
      // Should not reach here after guard 2, but defensive
      return {
        requiresFunding: false,
        rationale: intent.rationale,
        createdByAgent: true,
        skipReason: "low_score",
        skipDetail: "Score did not meet any amount policy tier after guard check.",
      };
    }

    const { amountWei, amountEth, pctUsed, thresholdUsed } = computed;

    // ── Guard 6: validate purpose string ─────────────────────────────────────
    const purposeRaw = intent.purpose.trim();
    const purposeError = this.validatePurpose(purposeRaw);
    if (purposeError) {
      return {
        requiresFunding: false,
        rationale: intent.rationale,
        createdByAgent: true,
        skipReason: "validation_failed",
        skipDetail: purposeError,
        policy: {
          evaluationScore: evaluation.score,
          credentialLevel,
          spendLimitEth,
          availableTreasuryEth,
          scoreThresholdUsed: thresholdUsed,
          pctOfLimitUsed: pctUsed,
        },
      };
    }

    // Prefix purpose with [Agent] so the on-chain record is self-identifying.
    // This appears on Arbiscan and in the spend request without needing any
    // off-chain lookup to distinguish agent-created from human-created.
    const onchainPurpose = `[Agent] ${purposeRaw}`;

    // Re-check length after prefix is added
    if (onchainPurpose.length > PURPOSE_MAX_LENGTH) {
      const truncated = onchainPurpose.slice(0, PURPOSE_MAX_LENGTH);
      console.warn(`[SpendDecisionService] Purpose truncated to ${PURPOSE_MAX_LENGTH} chars after prefix`);
      // Use truncated — still valid, just clipped
      intent.purpose = truncated;
    } else {
      intent.purpose = onchainPurpose;
    }

    const policy = {
      evaluationScore: evaluation.score,
      credentialLevel,
      spendLimitEth,
      availableTreasuryEth,
      scoreThresholdUsed: thresholdUsed,
      pctOfLimitUsed: pctUsed,
    };

    // ── Step 7: submit on-chain ───────────────────────────────────────────────
    console.log(`[SpendDecisionService] Creating spend request: ${amountEth} ETH — "${intent.purpose}"`);

    try {
      const onchain = await blockchainSvc.createSpendRequest(
        agentAddress,
        amountWei.toString(),
        intent.purpose
      );

      console.log(`[SpendDecisionService] Request #${onchain.requestId} created, tx: ${onchain.txHash}`);

      return {
        requiresFunding: true,
        rationale: intent.rationale,
        amountEth,
        purpose: intent.purpose,
        createdByAgent: true,
        spendRequestId: onchain.requestId,
        spendRequestTxHash: onchain.txHash,
        policy,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SpendDecisionService] On-chain submission failed: ${msg}`);

      // Decision was positive; return the intent even though on-chain failed.
      // The credential is recorded. The failed request can be retried manually
      // via the Treasury page if needed.
      return {
        requiresFunding: true,
        rationale: intent.rationale,
        amountEth,
        purpose: intent.purpose,
        createdByAgent: true,
        onchainError: msg,
        policy,
      };
    }
  }

  // ─── LLM call ──────────────────────────────────────────────────────────────

  /**
   * Narrowly-scoped LLM call.
   *
   * The model receives its own completed analysis and recommendation and decides:
   *   - requiresFunding: boolean (the primary gate)
   *   - purpose: string (the on-chain purpose, validated and prefixed by backend)
   *   - rationale: string (internal, shown in UI, not stored on-chain)
   *
   * Amount is NOT in the schema. The model is not asked to suggest a number.
   * Temperature 0.1 — this is classification + extraction, not generation.
   */
  private async extractIntent(task: Task, agentOutput: AgentOutput): Promise<LLMIntent> {
    const systemPrompt = `You are reviewing your own completed analysis to decide if a treasury spend request is warranted.
    Do not output <think> tags.
    Do not reveal reasoning.
    Return only the JSON object.

Task type: ${task.taskType}

Read your analysis and recommendation below. Then determine:
1. Does implementing your recommendation require treasury funds? Answer true ONLY if a capital outlay is directly implied (e.g. acquiring assets, deploying capital, paying for services). Answer false for monitoring, reviewing, reporting, or advisory actions.
2. If yes, write a concise on-chain purpose string (20-280 characters, professional, specific, no special chars except standard punctuation).
3. Write one sentence explaining your decision.

DEFAULT is false. Only set requiresFunding=true if you are certain capital is required.

Return ONLY valid JSON — no markdown, no commentary:
{
  "requiresFunding": <true|false>,
  "purpose": "<on-chain purpose string>",
  "rationale": "<one sentence>"
}`;

    const userMessage = `TASK: ${task.title}
TYPE: ${task.taskType}

YOUR ANALYSIS:
${agentOutput.analysis}

YOUR RECOMMENDATION:
${agentOutput.recommendation}

YOUR CONFIDENCE SCORE: ${agentOutput.confidenceScore}/100`;

    // const completion = await this.client.chat.completions.create({
    //   model: config.llm.model,
    //   messages: [
    //     { role: "system", content: systemPrompt },
    //     { role: "user", content: userMessage },
    //   ],
    //   temperature: 0.1,
    //   max_tokens: 256,
    //   response_format: { type: "json_object" },
    // });

    // const raw = completion.choices[0]?.message?.content ?? "";

    console.log("[SpendDecisionService] Calling LLM...");
    console.log(`[SpendDecisionService] Model: ${config.llm.model}`);

    let completion;

    try {
      completion = await this.client.chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        // response_format removed
      });

      console.log(
        "[SpendDecisionService] Raw response:",
        completion.choices?.[0]?.message?.content
      );

    } catch (err) {
      console.error("[SpendDecisionService] LLM error:", err);
      throw err;
    }

    const raw = completion.choices?.[0]?.message?.content ?? "";

    console.log("RAW INTENT:", raw);

    // const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

    const withoutThink = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();

    console.log("WITHOUT THINK:", withoutThink);

    const cleaned = withoutThink
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    console.log("CLEANED:", cleaned);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn(`[SpendDecisionService] Non-JSON from LLM: ${raw.slice(0, 80)}`);
      return {
        requiresFunding: false,
        purpose: "",
        rationale: "LLM returned malformed output; defaulting to no request.",
      };
    }

    const result = LLMIntentSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[SpendDecisionService] Schema validation failed`, result.error.flatten());
      return {
        requiresFunding: false,
        purpose: "",
        rationale: "LLM output failed schema validation; defaulting to no request.",
      };
    }

    return result.data;
  }

  // ─── Purpose validation ───────────────────────────────────────────────────

  private validatePurpose(purpose: string): string | null {
    if (purpose.length < PURPOSE_MIN_LENGTH) {
      return `Purpose too short (${purpose.length} chars; minimum ${PURPOSE_MIN_LENGTH}).`;
    }
    // Check against max minus the "[Agent] " prefix (8 chars)
    if (purpose.length > PURPOSE_MAX_LENGTH - 8) {
      return `Purpose too long (${purpose.length} chars; maximum ${PURPOSE_MAX_LENGTH - 8} before prefix is added).`;
    }
    // console.log("[SpendDecisionService] Validating purpose:", purpose);
    // console.log("[SpendDecisionService] Regex result:", PURPOSE_SAFE_REGEX.test(purpose));
    // if (!PURPOSE_SAFE_REGEX.test(purpose)) {
    //   return "Purpose contains disallowed characters.";
    // }
    return null;
  }
}

export const spendDecisionService = new SpendDecisionService();
