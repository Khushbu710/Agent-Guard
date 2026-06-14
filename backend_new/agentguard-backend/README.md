# AgentGuard Backend

Arbitrum-native trust framework backend for AI treasury agents.

## Overview

The backend owns the full pipeline from task creation to onchain credential:

```
POST /tasks/:id/execute
        ↓
  AgentService      → calls LLM (Groq/OpenAI-compatible), validates with Zod
        ↓
  EvaluationService → deterministic score 0–100, no randomness
        ↓
  EvidenceService   → keccak256(canonical JSON) → evidenceHash
        ↓
  BlockchainService → recordTaskCredential() on AgentGuard.sol
        ↓
  Report            → persisted, queryable via GET /reports/:id
```

---

## Setup

```bash
cp .env.example .env
# Fill in LLM_API_KEY, AGENT_SIGNER_PRIVATE_KEY, AGENTGUARD_CONTRACT_ADDRESS

npm install
npm run dev
```

---

## API Reference

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tasks` | Create a task |
| `GET` | `/tasks` | List all tasks |
| `GET` | `/tasks/:id` | Get a task |
| `POST` | `/tasks/:id/execute` | Run the full pipeline |

**POST /tasks** body:
```json
{
  "title": "Q3 Treasury Rebalance Review",
  "description": "Analyze the proposed rebalancing from 60/40 ETH/stablecoins to 40/60...",
  "taskType": "TreasuryAnalysis",
  "agentAddress": "0xYourAgentAddress"
}
```

Supported `taskType` values: `TreasuryAnalysis`, `GovernanceReview`, `RiskAssessment`

**POST /tasks/:id/execute** body (optional):
```json
{ "agentAddress": "0xOverrideAgentAddress" }
```

Returns the full `Report` object on completion.

---

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents/:address` | Read agent state from contract + backend task history |

---

### Reports

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/reports` | List all reports |
| `GET` | `/reports/:id` | Full report with evidence |

---

### Spend Requests

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/spend` | All spend requests from contract |
| `GET` | `/spend/:id` | Single spend request |

---

### Health

```
GET /health
```

Returns RPC connectivity and current block number.

---

## Evaluation Scoring

The `EvaluationService` scores agent output deterministically. Same input → same score, always.

| Dimension | Max | How |
|-----------|-----|-----|
| **Completeness** | 30 | analysis ≥ 200 chars (+10), ≥ 500 chars (+10), recommendation ≥ 100 chars (+10) |
| **Structural quality** | 25 | ≥ 3 paragraphs (+10), actionable verb in recommendation (+15) |
| **Confidence calibration** | 20 | LLM confidence in [40,90] (+10), within ±20 of 70 (+10) |
| **Task-type coherence** | 25 | 5 pts per domain keyword found, capped at 5 keywords |

Domain keywords by task type:
- **TreasuryAnalysis**: `liquidity`, `allocation`, `yield`, `portfolio`, `rebalance`, `stablecoin`, `drawdown`, `diversif`
- **GovernanceReview**: `proposal`, `quorum`, `veto`, `on-chain`, `delegate`, `snapshot`, `multisig`, `timelock`
- **RiskAssessment**: `exposure`, `severity`, `likelihood`, `mitigation`, `vector`, `exploit`, `slippage`, `liquidat`

---

## Evidence Verification

Anyone can independently verify a credential:

1. Fetch the report: `GET /reports/:id`
2. Read `report.evidence.canonicalPayload`
3. Compute `keccak256(toUtf8Bytes(canonicalPayload))`
4. Compare to `report.evidence.evidenceHash`
5. Compare to the hash stored on `AgentGuard.sol` for `report.credentialId`

The canonical payload has fixed field order:
```json
{
  "taskId": "<uuid>",
  "agentAddress": "<0x checksum>",
  "taskType": "<type>",
  "score": 82,
  "timestamp": "<ISO-8601, second precision>"
}
```

---

## Credential Levels

| Score | Level | Label |
|-------|-------|-------|
| 0–39 | 0 | Unverified |
| 40–59 | 1 | Basic |
| 60–74 | 2 | Intermediate |
| 75–89 | 3 | Advanced |
| 90–100 | 4 | Expert |

---

## Folder Structure

```
src/
  config/         env loading
  middleware/     error handler
  models/         Zod schemas + TypeScript types
  routes/         Express routers (tasks, agents, reports, spend)
  services/
    AgentService.ts       LLM execution + Zod validation
    EvaluationService.ts  deterministic scoring
    EvidenceService.ts    keccak256 evidence hash
    BlockchainService.ts  ethers v6, AgentGuard.sol reads + writes
    TaskService.ts        orchestration pipeline
    ReportService.ts      report retrieval
  utils/
    store.ts              in-memory task/report store
  index.ts                Express app + boot
```
