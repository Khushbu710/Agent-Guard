import type { Task, AgentOutput, EvaluationResult, TaskType } from "../models/index.js";

// ─── Scoring philosophy ───────────────────────────────────────────────────────
//
// This evaluator is deterministic and requires no external APIs.
// It avoids the two failure modes of the previous version:
//
//   Old failure 1 — Length as a proxy for completeness.
//     A 500-char paragraph of filler scored identically to a 500-char paragraph
//     of rigorous analysis. Threshold-based character counts reward padding.
//
//   Old failure 2 — Keyword presence as a proxy for domain relevance.
//     A single mention of "liquidity" in a dismissal ("I will not assess
//     liquidity here") earned the same points as a full liquidity analysis.
//     Keywords can appear in negations, transitions, or boilerplate.
//
// The new approach uses three categories of heuristic:
//
//   Concept clusters — a cluster is a group of semantically related terms.
//     Matching any term in a cluster confirms the concept was engaged.
//     Distinct clusters must be covered; density within one cluster is ignored.
//
//   Reasoning markers — connective language that signals a claim is being
//     supported, qualified, or derived. "because", "therefore", "however",
//     "assuming", "given that" are structural indicators of analytical prose.
//     Their presence doesn't guarantee quality, but their complete absence
//     almost always signals shallow output.
//
//   Structural indicators — does the output contain the expected components
//     of a complete analysis for the task type? Each task type has a defined
//     minimum set of components (current state, risk/concern, recommendation,
//     rationale). Component detection uses concept clusters, not raw keywords.
//
// None of these indicators is sufficient alone. The score reflects all four
// dimensions together. A padded, keyword-stuffed output that contains no
// reasoning markers will score low on reasoning depth despite high coherence.
// A short but precise output that covers all components and provides a clear
// decision with rationale can score well despite short length.

// ─── Reasoning markers ────────────────────────────────────────────────────────
//
// These are linguistic connectives that appear in analytical writing when a
// claim is being supported, qualified, contrasted, or derived. They are
// language-agnostic structural markers rather than domain vocabulary.
//
// Each marker is matched as a substring (case-insensitive). Multi-word phrases
// are matched as written; single words are checked as substrings so that
// "therefore" matches "therefore" and "therefores" but not "there".
// Grouped by function so the breakdown is explainable.

const REASONING_MARKERS = {
  // Causal / because-reasoning: the agent is justifying a claim
  causal: [
    "because",
    "since",
    "given that",
    "due to",
    "as a result",
    "consequently",
    "this is caused by",
    "stems from",
    "driven by",
  ],

  // Conditional / if-then reasoning: the agent is reasoning under uncertainty
  conditional: [
    "if ",
    "unless",
    "assuming",
    "provided that",
    "in the event",
    "contingent",
    "subject to",
    "depends on",
    "in case",
  ],

  // Contrastive / adversarial reasoning: the agent is holding tension
  contrastive: [
    "however",
    "although",
    "despite",
    "on the other hand",
    "while ",
    "whereas",
    "notwithstanding",
    "that said",
    "nevertheless",
    "yet ",
  ],

  // Inferential / therefore-reasoning: the agent is drawing a conclusion
  inferential: [
    "therefore",
    "thus ",
    "hence ",
    "this suggests",
    "this indicates",
    "this means",
    "it follows",
    "we can conclude",
    "this implies",
  ],

  // Quantitative grounding: the agent is anchoring claims in numbers
  quantitative: [
    "%",
    " basis points",
    " bps",
    "million",
    "billion",
    " eth",
    " usdc",
    " usdt",
    " dai",
    "multiples",
    "ratio",
    "threshold",
    "target",
    "ceiling",
    "floor",
    "range of",
  ],
} as const;

type MarkerGroup = keyof typeof REASONING_MARKERS;

// ─── Domain concept clusters ──────────────────────────────────────────────────
//
// A concept cluster is a set of surface forms for a single analytical concept.
// Matching ANY term in the cluster confirms the concept is engaged.
// Points are earned per distinct cluster covered, not per term matched.
//
// Clusters are designed so that a thoughtful analysis will cover them naturally.
// Boilerplate and introductory sentences rarely trigger multiple clusters.

type ConceptCluster = { name: string; terms: string[] };

const DOMAIN_CLUSTERS: Record<TaskType, ConceptCluster[]> = {
  TreasuryAnalysis: [
    {
      name: "liquidity position",
      terms: ["liquid", "illiquid", "liquidity", "cash position", "runway", "working capital"],
    },
    {
      name: "asset allocation",
      terms: ["allocat", "weighting", "weight", "composition", "mix", "proportion", "split between"],
    },
    {
      name: "yield or return",
      terms: ["yield", "return", "apy", "apr", "interest rate", "earnings", "revenue", "income"],
    },
    {
      name: "risk exposure",
      terms: ["risk", "exposure", "volatility", "drawdown", "downside", "impairment", "loss"],
    },
    {
      name: "diversification",
      terms: ["diversif", "concentration", "correlated", "uncorrelated", "spread", "single asset"],
    },
    {
      name: "stablecoin or stable asset",
      terms: ["stablecoin", "stable", "usdc", "usdt", "dai", "fiat", "peg"],
    },
    {
      name: "protocol or on-chain context",
      terms: ["protocol", "on-chain", "onchain", "smart contract", "defi", "vault", "treasury"],
    },
    {
      name: "time horizon",
      terms: ["short-term", "long-term", "medium-term", "horizon", "quarter", "annual", "period", "runway"],
    },
  ],

  GovernanceReview: [
    {
      name: "proposal mechanics",
      terms: ["proposal", "propose", "motion", "amendment", "vote", "ballot"],
    },
    {
      name: "quorum or participation",
      terms: ["quorum", "participation rate", "voter turnout", "eligible voter", "total supply"],
    },
    {
      name: "voting power or delegation",
      terms: ["voting power", "delegate", "delegat", "token weight", "vetoken", "governance token"],
    },
    {
      name: "execution or timelock",
      terms: ["timelock", "time lock", "execution delay", "queue", "eta", "grace period", "cooldown"],
    },
    {
      name: "veto or guardian",
      terms: ["veto", "guardian", "multisig", "council", "veto power", "emergency"],
    },
    {
      name: "on-chain implementation",
      terms: ["on-chain", "onchain", "calldata", "target address", "selector", "payload", "executor"],
    },
    {
      name: "constitutional or rule alignment",
      terms: ["constitution", "charter", "rule", "bylaw", "protocol law", "precedent", "scope"],
    },
    {
      name: "conflict of interest or risk",
      terms: ["conflict", "interest alignment", "incentive", "capture", "plutocracy", "whale", "sybil"],
    },
  ],

  RiskAssessment: [
    {
      name: "threat or attack vector",
      terms: ["vector", "attack", "exploit", "threat", "adversar", "malicious", "vulnerability"],
    },
    {
      name: "likelihood or probability",
      terms: ["likelihood", "probability", "probable", "likely", "chance", "frequency", "expected rate"],
    },
    {
      name: "impact or severity",
      terms: ["impact", "severity", "magnitude", "consequence", "blast radius", "damage", "loss"],
    },
    {
      name: "existing controls",
      terms: ["control", "safeguard", "protection", "defence", "defense", "guard", "circuit breaker", "pause"],
    },
    {
      name: "mitigation strategy",
      terms: ["mitigat", "remediat", "address", "reduce", "eliminate", "patch", "fix", "harden"],
    },
    {
      name: "financial or slippage risk",
      terms: ["slippage", "price impact", "liquidity risk", "market risk", "liquidat", "under-collateral"],
    },
    {
      name: "operational or systemic risk",
      terms: ["systemic", "operational", "centrali", "single point", "key person", "dependency", "upgrade risk"],
    },
    {
      name: "residual risk or acceptance",
      terms: ["residual", "accept", "tolerance", "appetite", "threshold", "within bounds", "manageable"],
    },
  ],
};

// ─── Required components per task type ───────────────────────────────────────
//
// A complete analysis for each task type should address a minimum set of
// analytical components. Each component is identified by a concept cluster.
// Missing components reduce the completeness score.
//
// These are chosen to be the non-negotiable elements of each task type:
// things an analyst would always address regardless of the specific task.
// The cluster names reference the DOMAIN_CLUSTERS defined above.

const REQUIRED_COMPONENT_CLUSTERS: Record<TaskType, string[]> = {
  TreasuryAnalysis: [
    "liquidity position",
    "asset allocation",
    "risk exposure",
    "yield or return",
  ],
  GovernanceReview: [
    "proposal mechanics",
    "voting power or delegation",
    "on-chain implementation",
    "conflict of interest or risk",
  ],
  RiskAssessment: [
    "threat or attack vector",
    "likelihood or probability",
    "impact or severity",
    "mitigation strategy",
  ],
};

// ─── Actionable decision patterns ─────────────────────────────────────────────
//
// A recommendation earns points across three sub-criteria:
//
//   1. Decision presence — the recommendation contains an explicit decision verb.
//      These are directional words that commit the agent to a position.
//
//   2. Rationale clause — the decision is grounded with a reason.
//      Signalled by connective language following or preceding the decision.
//
//   3. Condition or constraint — the recommendation qualifies the decision.
//      Signalled by conditional or contingency language.
//
// This replaces the old binary "has at least one actionable verb" check.

const DECISION_VERBS = [
  "approve",
  "reject",
  "deny",
  "halt",
  "pause",
  "resume",
  "increase",
  "decrease",
  "reduce",
  "expand",
  "maintain",
  "defer",
  "delay",
  "escalate",
  "implement",
  "deploy",
  "withdraw",
  "reallocate",
  "diversify",
  "monitor",
  "do not",
  "should not",
  "must not",
  "recommend against",
  "recommend proceeding",
  "advise against",
];

const RATIONALE_CONNECTIVES = [
  "because",
  "since",
  "given",
  "due to",
  "as ",
  "in light of",
  "based on",
  "considering",
  "given that",
  "as a result of",
  "following",
];

const CONDITION_MARKERS = [
  "subject to",
  "provided that",
  "contingent on",
  "assuming",
  "if ",
  "unless",
  "pending",
  "on condition",
  "with the caveat",
  "following review",
  "after",
  "once ",
  "prior to",
  "before",
  "with approval",
  "with monitoring",
];

// ─── Helper functions ─────────────────────────────────────────────────────────

/** Case-insensitive substring test. */
function contains(text: string, term: string): boolean {
  return text.includes(term.toLowerCase());
}

/** Count how many distinct marker groups appear in the text. */
function countReasoningGroups(text: string): {
  groupsPresent: MarkerGroup[];
  groupCount: number;
} {
  const groupsPresent: MarkerGroup[] = [];

  for (const [group, markers] of Object.entries(REASONING_MARKERS) as [
    MarkerGroup,
    readonly string[]
  ][]) {
    if (markers.some((m) => contains(text, m))) {
      groupsPresent.push(group);
    }
  }

  return { groupsPresent, groupCount: groupsPresent.length };
}

/**
 * For a given task type, return which required component clusters are present
 * in the combined text and which are absent.
 */
function assessComponents(
  text: string,
  taskType: TaskType
): { present: string[]; absent: string[] } {
  const required = REQUIRED_COMPONENT_CLUSTERS[taskType];
  const allClusters = DOMAIN_CLUSTERS[taskType];
  const clusterMap = new Map(allClusters.map((c) => [c.name, c.terms]));

  const present: string[] = [];
  const absent: string[] = [];

  for (const componentName of required) {
    const terms = clusterMap.get(componentName);
    if (!terms) {
      absent.push(componentName);
      continue;
    }
    const found = terms.some((t) => contains(text, t));
    (found ? present : absent).push(componentName);
  }

  return { present, absent };
}

/**
 * Count how many domain concept clusters (beyond required components) are
 * covered in the text. Returns covered cluster names.
 */
function countCoveredClusters(
  text: string,
  taskType: TaskType
): string[] {
  return DOMAIN_CLUSTERS[taskType]
    .filter((cluster) => cluster.terms.some((t) => contains(text, t)))
    .map((cluster) => cluster.name);
}

// ─── EvaluationService ────────────────────────────────────────────────────────

export class EvaluationService {
  /**
   * Score an agent's output deterministically.
   *
   * This function is pure: given the same inputs it always produces the
   * same score. No randomness. No LLM calls. No external I/O.
   *
   * ┌─────────────────────────────────────────────────┬──────────┐
   * │ Dimension                                       │ Max pts  │
   * ├─────────────────────────────────────────────────┼──────────┤
   * │ 1. Completeness      (component coverage)       │   30     │
   * │ 2. Reasoning depth   (structural markers)       │   25     │
   * │ 3. Actionability     (decision + rationale)     │   20     │
   * │ 4. Domain relevance  (concept cluster breadth)  │   25     │
   * └─────────────────────────────────────────────────┴──────────┘
   *                                              Total:   100
   *
   * ── Dimension 1: Completeness (0–30) ────────────────────────────────────────
   *
   * Measures whether the analysis addresses the required structural components
   * for the task type. Each task type has 4 required components.
   *
   *   All 4 required components present:        30 pts
   *   3 of 4 required components present:       20 pts
   *   2 of 4 required components present:       10 pts
   *   1 of 4 required components present:        4 pts
   *   0 of 4 required components present:        0 pts
   *
   * Components are detected via concept clusters (groups of related terms),
   * not single keywords. This means a cluster like "liquidity position" is
   * satisfied by "liquid", "illiquid", "cash position", "runway", etc.
   *
   * ── Dimension 2: Reasoning depth (0–25) ─────────────────────────────────────
   *
   * Measures the presence of reasoning connectives across distinct functional
   * groups: causal, conditional, contrastive, inferential, quantitative.
   *
   * Each group present adds points. Points are awarded for the ANALYSIS text
   * only (not the recommendation) since reasoning depth is an analysis quality.
   *
   *   5 groups present:   25 pts
   *   4 groups present:   20 pts
   *   3 groups present:   14 pts
   *   2 groups present:    8 pts
   *   1 group present:     3 pts
   *   0 groups present:    0 pts
   *
   * This rewards breadth of reasoning types, not density of any single type.
   * A quantitative claim + a causal justification + a conditional caveat scores
   * higher than a paragraph that repeats "because" ten times.
   *
   * ── Dimension 3: Actionability (0–20) ────────────────────────────────────────
   *
   * Measures whether the recommendation commits to a decision and grounds it.
   * Three independent sub-criteria, assessed on the RECOMMENDATION text only:
   *
   *   Decision verb present:       8 pts
   *     An explicit directional decision: approve, reject, halt, defer, etc.
   *
   *   Rationale clause present:    7 pts
   *     The decision is grounded: "because", "given", "due to", "based on", etc.
   *
   *   Condition or constraint:     5 pts
   *     The recommendation is qualified: "subject to", "pending", "unless", etc.
   *
   * This replaces the old binary "has at least one actionable verb" (0 or 15 pts).
   * A recommendation of "reject" alone scores 8/20.
   * A recommendation of "reject because the risk exceeds tolerance, subject to
   * re-assessment after the audit" scores 20/20.
   *
   * ── Dimension 4: Domain relevance (0–25) ─────────────────────────────────────
   *
   * Measures breadth of domain concept coverage in the combined text.
   * Each task type has 8 concept clusters. Points scale with cluster coverage:
   *
   *   ≥ 7 clusters covered:   25 pts
   *   6 clusters covered:     21 pts
   *   5 clusters covered:     16 pts
   *   4 clusters covered:     11 pts
   *   3 clusters covered:      6 pts
   *   2 clusters covered:      2 pts
   *   ≤ 1 cluster covered:     0 pts
   *
   * This rewards analytical breadth. An output that deeply covers one concept
   * (e.g. repeatedly mentions "liquidity") while ignoring others scores lower
   * than one that addresses each cluster at least once.
   */
  evaluate(task: Task, output: AgentOutput): EvaluationResult {
    const analysisLower = output.analysis.toLowerCase();
    const recommendationLower = output.recommendation.toLowerCase();
    const combined = `${analysisLower} ${recommendationLower}`;

    // ── 1. Completeness: required component coverage (0–30) ──────────────────
    //
    // Checks how many of the 4 task-type-specific required components are
    // addressed in the combined analysis + recommendation text.

    const { present: componentsPresent, absent: componentsAbsent } =
      assessComponents(combined, task.taskType);

    const completenessPoints = [0, 4, 10, 20, 30];
    const completeness = completenessPoints[componentsPresent.length] ?? 0;

    // ── 2. Reasoning depth: structural marker groups (0–25) ──────────────────
    //
    // Counts distinct reasoning marker groups in the ANALYSIS text only.
    // Recommendation is excluded: a reasoning score on a one-line recommendation
    // would reward the wrong thing.

    const { groupsPresent, groupCount } = countReasoningGroups(analysisLower);
    const structuralQualityPoints = [0, 3, 8, 14, 20, 25];
    const structuralQuality = structuralQualityPoints[Math.min(groupCount, 5)] ?? 0;

    // ── 3. Actionability: decision + rationale + condition (0–20) ────────────
    //
    // Assessed on the RECOMMENDATION text only.

    let confidenceCalibration = 0; // field name preserved for interface compatibility

    const hasDecision = DECISION_VERBS.some((v) => contains(recommendationLower, v));
    if (hasDecision) confidenceCalibration += 8;

    const hasRationale = RATIONALE_CONNECTIVES.some((c) =>
      contains(recommendationLower, c)
    );
    if (hasRationale) confidenceCalibration += 7;

    const hasCondition = CONDITION_MARKERS.some((m) =>
      contains(recommendationLower, m)
    );
    if (hasCondition) confidenceCalibration += 5;

    // ── 4. Domain relevance: concept cluster breadth (0–25) ──────────────────
    //
    // Counts distinct concept clusters covered in the combined text.
    // Each task type has 8 clusters; breadth is rewarded over depth.

    const coveredClusters = countCoveredClusters(combined, task.taskType);
    const clusterCount = coveredClusters.length;
    const coherencePoints = [0, 0, 2, 6, 11, 16, 21, 25, 25];
    const taskTypeCoherence = coherencePoints[Math.min(clusterCount, 8)] ?? 0;

    // ── Final score ───────────────────────────────────────────────────────────

    const score =
      completeness + structuralQuality + confidenceCalibration + taskTypeCoherence;

    // keywordsFound carries all evidence for auditability:
    // components present, reasoning groups, clusters covered.
    const keywordsFound = [
      ...componentsPresent.map((c) => `component:${c}`),
      ...componentsAbsent.map((c) => `missing:${c}`),
      ...groupsPresent.map((g) => `reasoning:${g}`),
      ...coveredClusters.map((cl) => `cluster:${cl}`),
    ];

    return {
      score: Math.min(100, Math.max(0, score)),
      breakdown: {
        completeness,
        structuralQuality,
        confidenceCalibration, // now represents Actionability; name preserved for interface
        taskTypeCoherence,
      },
      keywordsFound,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export const evaluationService = new EvaluationService();
