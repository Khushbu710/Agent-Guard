// ─── Enums ────────────────────────────────────────────────────────────────────

export type TaskType = 'TreasuryAnalysis' | 'GovernanceReview' | 'RiskAssessment'
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'
export type RequestStatus = 0 | 1 | 2 | 3 | 4 // Pending Approved Executed Rejected Cancelled
export type CredentialLevel = 0 | 1 | 2 | 3   // None Bronze Silver Gold

export const CREDENTIAL_LABEL: Record<number, string> = {
  0: 'None', 1: 'Bronze', 2: 'Silver', 3: 'Gold',
}
export const REQUEST_STATUS_LABEL: Record<number, string> = {
  0: 'Pending', 1: 'Approved', 2: 'Executed', 3: 'Rejected', 4: 'Cancelled',
}
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  TreasuryAnalysis: 'Treasury Analysis',
  GovernanceReview: 'Governance Review',
  RiskAssessment: 'Risk Assessment',
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: string
  title: string
  description: string
  taskType: TaskType
  status: TaskStatus
  createdAt: string
  agentAddress?: string
  reportId?: string
  error?: string
}

// ─── AgentOutput ──────────────────────────────────────────────────────────────

export interface AgentOutput {
  analysis: string
  recommendation: string
  confidenceScore: number
  rawModel: string
  promptTokens: number
  completionTokens: number
  durationMs: number
}

// ─── EvaluationResult ─────────────────────────────────────────────────────────

export interface EvaluationBreakdown {
  completeness: number
  structuralQuality: number
  confidenceCalibration: number
  taskTypeCoherence: number
}

export interface EvaluationResult {
  score: number
  breakdown: EvaluationBreakdown
  keywordsFound: string[]
  evaluatedAt: string
}

// ─── EvidencePackage ──────────────────────────────────────────────────────────

export interface EvidencePackage {
  evidenceHash: string
  canonicalPayload: string
  metadata: {
    taskId: string
    agentAddress: string
    taskType: TaskType
    score: number
    timestamp: string
  }
}

// ─── TreasuryDecision ────────────────────────────────────────────────────────

export interface TreasuryDecisionPolicy {
  evaluationScore: number
  credentialLevel: number
  spendLimitEth: string
  availableTreasuryEth: string
  scoreThresholdUsed: number
  pctOfLimitUsed: number
}

export interface TreasuryDecision {
  requiresFunding: boolean
  rationale: string
  amountEth?: string
  purpose?: string
  createdByAgent: true
  spendRequestId?: number
  spendRequestTxHash?: string
  skipReason?: string
  skipDetail?: string
  onchainError?: string
  policy?: TreasuryDecisionPolicy
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface Report {
  id: string
  taskId: string
  agentAddress: string
  task: Task
  agentOutput: AgentOutput
  evaluation: EvaluationResult
  evidence: EvidencePackage
  txHash?: string
  completedTasksOnchain?: number
  newAverageScoreOnchain?: number
  treasuryDecision?: TreasuryDecision
  createdAt: string
}

// ─── Agent (onchain) ──────────────────────────────────────────────────────────

export interface OnchainAgent {
  owner: string
  name: string
  completedTasks: number
  averageScore: number
  credentialLevel: number
  credentialLevelLabel: string
  totalReleasedWei: string
  pendingCount: number
}

export interface OnchainAgentSummary extends OnchainAgent {
  spendLimit: string
  pendingLimit: number
  availableTreasury: string
}

export interface AgentProfile {
  address: string
  onchain: OnchainAgent
  backendTaskHistory: Task[]
  backendTaskCount: number
}

export interface AgentResponse {
  agent: AgentProfile
}

export interface AgentSummaryResponse {
  summary: OnchainAgentSummary & { address: string }
}

// ─── Spend Requests ───────────────────────────────────────────────────────────

export interface SpendRequest {
  requestId: number
  agent: string
  amount: string
  purpose: string
  timestamp: number
  status: number
  statusLabel: string
  rejectionReason?: string
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string
  timestamp: string
  blockchain: {
    connected: boolean
    blockNumber?: number
    chainId?: string
  }
  contract: string
}

// ─── API Response wrappers ────────────────────────────────────────────────────

export interface TasksResponse { tasks: Task[]; count: number }
export interface TaskResponse { task: Task }
export interface ReportsResponse { reports: Report[]; count: number }
export interface ReportResponse { report: Report }
export interface SpendResponse { spendRequests: SpendRequest[]; count: number }
export interface SpendSingleResponse { spendRequest: SpendRequest }
export interface ExecuteResponse { report: Report }

// ─── Treasury ─────────────────────────────────────────────────────────────────

export interface TreasuryBalance {
  totalBalanceWei: string
  availableWei: string
  escrowedWei: string
}

export interface TreasuryBalanceResponse {
  balance: TreasuryBalance
}

export interface DepositInput {
  amountEth: string
}

export interface DepositResponse {
  txHash: string
  blockNumber: number
  depositedEth: string
  newBalanceWei: string
}

export interface CreateSpendRequestInput {
  agentAddress: string
  amountEth: string
  purpose: string
}

export interface CreateSpendRequestResponse {
  requestId: number
  txHash: string
  blockNumber: number
}

export interface TxReceiptResponse {
  txHash: string
  blockNumber: number
}

export interface ExecuteSpendResponse extends TxReceiptResponse {
  executedAmountWei: string
}

// ─── Form inputs ──────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string
  description: string
  taskType: TaskType
  agentAddress: string
}
