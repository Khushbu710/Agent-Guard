import OpenAI from "openai";
import { config } from "../config/index.js";
import { LLMResponseSchema } from "../models/index.js";
import type { Task, AgentOutput, TaskType } from "../models/index.js";

// ─── System prompts per task type ─────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<TaskType, string> = {
  TreasuryAnalysis: `You are an expert treasury analyst for a decentralized autonomous organization.
Your job is to analyze treasury-related tasks with rigor.
You MUST evaluate: liquidity positions, asset allocation, yield opportunities, risk exposure, and portfolio balance.
Always ground your analysis in specific financial reasoning.
Return ONLY valid JSON with these exact fields:
{
  "analysis": "<detailed analysis, minimum 300 words>",
  "recommendation": "<clear actionable recommendation with approve/reject/monitor decision>",
  "confidenceScore": <number 0-100>
}`,

  GovernanceReview: `You are an expert governance reviewer for a decentralized protocol.
Your job is to review governance proposals with constitutional rigor.
You MUST evaluate: proposal legitimacy, quorum requirements, voting mechanics, veto conditions, and on-chain execution risks.
Always assess potential unintended consequences.
Return ONLY valid JSON with these exact fields:
{
  "analysis": "<detailed governance analysis, minimum 300 words>",
  "recommendation": "<clear approve/reject/abstain recommendation with rationale>",
  "confidenceScore": <number 0-100>
}`,

  RiskAssessment: `You are an expert risk assessor for a decentralized protocol treasury.
Your job is to assess risk with methodical precision.
You MUST evaluate: attack vectors, exposure severity, likelihood of occurrence, blast radius, and mitigation strategies.
Always quantify risk where possible.
Return ONLY valid JSON with these exact fields:
{
  "analysis": "<detailed risk assessment, minimum 300 words>",
  "recommendation": "<clear risk mitigation recommendation with severity rating>",
  "confidenceScore": <number 0-100>
}`,
};

// ─── AgentService ─────────────────────────────────────────────────────────────

export class AgentService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });
  }

  /**
   * Execute a task using the LLM.
   * Returns a validated AgentOutput — never raw model output.
   * Throws if the model returns malformed JSON or fails validation.
   */
  async execute(task: Task): Promise<AgentOutput> {
    const systemPrompt = SYSTEM_PROMPTS[task.taskType];

    const userMessage = `TASK ID: ${task.id}
TASK TYPE: ${task.taskType}
TITLE: ${task.title}

DESCRIPTION:
${task.description}

Analyze this task thoroughly. Return ONLY the JSON object as specified.`;

    const start = Date.now();

    const completion = await this.client.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3, // lower = more deterministic, better for analysis
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    const durationMs = Date.now() - start;

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("LLM returned empty content");
    }

    // Strip markdown fences if model wraps despite response_format
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`LLM output was not valid JSON. Raw: ${raw.slice(0, 200)}`);
    }

    // Validate with Zod — the output is not trusted until it passes
    const validated = LLMResponseSchema.parse(parsed);

    // Clamp confidence to 0–100 (model may hallucinate out-of-range values)
    const confidenceScore = Math.min(100, Math.max(0, Math.round(validated.confidenceScore)));

    return {
      analysis: validated.analysis.trim(),
      recommendation: validated.recommendation.trim(),
      confidenceScore,
      rawModel: config.llm.model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      durationMs,
    };
  }
}

export const agentService = new AgentService();
