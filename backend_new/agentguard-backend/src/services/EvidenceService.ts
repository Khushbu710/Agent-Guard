import { ethers } from "ethers";
import type { Task, AgentOutput, EvaluationResult, EvidencePackage } from "../models/index.js";

/**
 * EvidenceService
 *
 * Produces an evidenceHash that is:
 *  1. Deterministic — same inputs always produce the same hash
 *  2. Verifiable — anyone with the canonical payload can recompute and confirm
 *  3. Replay-safe — timestamp is included so old evidence cannot be resubmitted
 *  4. Contract-compatible — keccak256 of UTF-8 bytes matches Solidity's
 *     keccak256(bytes(payload)) pattern
 *
 * ─── What is hashed ─────────────────────────────────────────────────────────
 *
 * A canonical JSON string with EXACTLY these fields in EXACTLY this order:
 * {
 *   "taskId":       "<uuid>",
 *   "agentAddress": "<0x checksum address>",
 *   "taskType":     "<TreasuryAnalysis | GovernanceReview | RiskAssessment>",
 *   "score":        <integer 0-100>,
 *   "timestamp":    "<ISO-8601 UTC string, rounded to the second>"
 * }
 *
 * Fields NOT included (intentionally):
 *   - The full analysis text (too large for onchain storage; the hash suffices)
 *   - The breakdown scores (can be reconstructed from the report)
 *   - The recommendation text (same reason)
 *
 * ─── How it is hashed ────────────────────────────────────────────────────────
 *
 * ethers.keccak256(ethers.toUtf8Bytes(canonicalJSON))
 *
 * This is equivalent to Solidity's:
 *   bytes32 hash = keccak256(bytes(canonicalJSON));
 *
 * ─── Why it is verifiable ────────────────────────────────────────────────────
 *
 * The backend stores the exact canonicalPayload string alongside the hash
 * in the Report. Anyone can:
 *   1. Fetch the report from GET /reports/:id
 *   2. Read evidence.canonicalPayload
 *   3. Compute keccak256(toUtf8Bytes(canonicalPayload))
 *   4. Compare to evidence.evidenceHash
 *   5. Compare to the hash stored on AgentGuard.sol for that credential
 *
 * If all three match, the credential is authentic.
 */
export class EvidenceService {
  generate(
    task: Task,
    output: AgentOutput,
    evaluation: EvaluationResult,
    agentAddress: string
  ): EvidencePackage {
    // Round to second precision — sub-second differences cause non-reproducible hashes
    const timestamp = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();

    // Normalize to EIP-55 checksum address for consistency
    const normalizedAddress = ethers.getAddress(agentAddress);

    // Build canonical payload — field ORDER is fixed and must never change
    // without a corresponding contract upgrade
    const metadata = {
      taskId: task.id,
      agentAddress: normalizedAddress,
      taskType: task.taskType,
      score: evaluation.score,
      timestamp,
    };

    // JSON.stringify with no replacer and no indentation guarantees byte-exact output
    const canonicalPayload = JSON.stringify(metadata);

    // Compute keccak256 — matches Solidity keccak256(bytes(canonicalPayload))
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalPayload));

    return {
      evidenceHash,
      canonicalPayload,
      metadata,
    };
  }

  /**
   * Verify a previously generated evidence package.
   * Returns true if the stored hash matches a fresh computation from the payload.
   */
  verify(pkg: EvidencePackage): boolean {
    const recomputed = ethers.keccak256(ethers.toUtf8Bytes(pkg.canonicalPayload));
    return recomputed === pkg.evidenceHash;
  }
}

export const evidenceService = new EvidenceService();
