import { useState } from 'react'
import {
  ArrowUpRight, ChevronRight, Shield, Copy, CheckCheck,
  Bot, CircleDot, XCircle, AlertTriangle, CheckCircle2,
  Landmark, TrendingUp,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Page } from '../components/layout/Page'

import { ErrorState, EmptyState, PageLoader } from '../components/ui/primitives'
import { useReports, useReport } from '../hooks'
import {
  truncateAddress, formatDateTime, scoreColor,
  shortenHash, arbiscanTx, formatDuration, formatWei,
} from '../lib/utils'
import type { Report, TreasuryDecision } from '../types'
import { TASK_TYPE_LABEL } from '../types'

// ─── Shared ───────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  const color = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#9CA3AF]">{label}</span>
        <span className="font-medium" style={{ color }}>{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-[#1F2937] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors">
      {copied ? <CheckCheck className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Treasury Decision Panel ──────────────────────────────────────────────────
//
// Renders the agent's autonomous spend decision inline in the report.
// Three visual states:
//   • Funded + confirmed  — green header, spend request ID + tx link
//   • Funded + failed     — amber header, intended amount + error
//   • No request          — neutral header, skip reason chip + rationale

function SkipReasonBadge({ reason }: { reason?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    no_credential:       { label: 'No credential',     cls: 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/20' },
    low_score:           { label: 'Score too low',     cls: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20' },
    agent_declined:      { label: 'Not required',      cls: 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20' },
    validation_failed:   { label: 'Validation failed', cls: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20' },
    spend_limit_exceeded:{ label: 'Exceeds limit',     cls: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20' },
    no_available_funds:  { label: 'No funds',          cls: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20' },
  }
  const entry = reason ? (map[reason] ?? { label: reason, cls: 'bg-[#374151]/10 text-[#6B7280] border-[#374151]/20' }) : null
  if (!entry) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium border rounded-sm ${entry.cls}`}>
      {entry.label}
    </span>
  )
}

function TreasuryDecisionPanel({ decision }: { decision: TreasuryDecision }) {
  const [showPolicy, setShowPolicy] = useState(false)

  // ── State: funded and confirmed on-chain ────────────────────────────────────
  if (decision.requiresFunding && decision.spendRequestId !== undefined) {
    return (
      <div className="border border-[#10B981]/30 bg-[#111827]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#10B981]/20 flex items-center justify-between bg-[#10B981]/5">
          <div className="flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-[#10B981]" />
            <p className="text-[10px] text-[#10B981] uppercase tracking-wider font-semibold">
              Agent Treasury Request — Submitted
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CircleDot className="w-3 h-3 text-[#F59E0B]" />
            <span className="text-[10px] text-[#6B7280]">Pending owner approval</span>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Core facts */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-[#6B7280] mb-1">Request ID</p>
              <p className="text-sm font-semibold text-[#F9FAFB] font-mono">
                #{decision.spendRequestId}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#6B7280] mb-1">Amount</p>
              <p className="text-sm font-semibold text-[#10B981]">
                {decision.amountEth ? formatWei(
                  // formatWei expects wei string; convert ETH → wei string for display
                  // Use formatEth display directly since we have ETH already
                  decision.amountEth
                    ? String(BigInt(Math.round(parseFloat(decision.amountEth) * 1e18)))
                    : '0'
                ) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#6B7280] mb-1">Origin</p>
              <div className="flex items-center gap-1">
                <Bot className="w-3 h-3 text-[#3B82F6]" />
                <span className="text-[10px] text-[#3B82F6]">Agent-generated</span>
              </div>
            </div>
          </div>

          {/* Purpose */}
          <div className="border-t border-[#1F2937] pt-3">
            <p className="text-[10px] text-[#6B7280] mb-1">On-chain Purpose</p>
            <p className="text-xs text-[#F9FAFB] font-mono bg-[#0B0F1A] border border-[#1F2937] px-3 py-2">
              {decision.purpose}
            </p>
          </div>

          {/* Rationale */}
          <div>
            <p className="text-[10px] text-[#6B7280] mb-1">Agent Rationale</p>
            <p className="text-xs text-[#9CA3AF] leading-relaxed italic">"{decision.rationale}"</p>
          </div>

          {/* Tx link */}
          {decision.spendRequestTxHash && (
            <div className="border-t border-[#1F2937] pt-3 flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-[#10B981]" />
              <span className="text-[10px] text-[#6B7280]">Transaction confirmed</span>
              <a
                href={arbiscanTx(decision.spendRequestTxHash)}
                target="_blank" rel="noreferrer"
                className="text-[10px] font-mono text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-0.5"
              >
                {shortenHash(decision.spendRequestTxHash)} <ArrowUpRight className="w-2.5 h-2.5" />
              </a>
            </div>
          )}

          {/* Deterministic policy trace */}
          {decision.policy && (
            <div className="border-t border-[#1F2937] pt-3">
              <button
                onClick={() => setShowPolicy(v => !v)}
                className="text-[10px] text-[#6B7280] hover:text-[#9CA3AF] flex items-center gap-1"
              >
                <TrendingUp className="w-3 h-3" />
                {showPolicy ? 'Hide' : 'Show'} amount policy trace
                <ChevronRight className={`w-3 h-3 transition-transform ${showPolicy ? 'rotate-90' : ''}`} />
              </button>
              {showPolicy && (
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Evaluation score</span>
                    <span className="text-[#F9FAFB]">{decision.policy.evaluationScore}/100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Score threshold used</span>
                    <span className="text-[#F9FAFB]">≥ {decision.policy.scoreThresholdUsed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Credential level</span>
                    <span className="text-[#F9FAFB]">{['None','Bronze','Silver','Gold'][decision.policy.credentialLevel] ?? decision.policy.credentialLevel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">% of spend limit</span>
                    <span className="text-[#F9FAFB]">{decision.policy.pctOfLimitUsed}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Spend limit</span>
                    <span className="text-[#F9FAFB]">{decision.policy.spendLimitEth} ETH</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Available treasury</span>
                    <span className="text-[#F9FAFB]">{decision.policy.availableTreasuryEth} ETH</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── State: funded intent but on-chain call failed ───────────────────────────
  if (decision.requiresFunding && !decision.spendRequestId) {
    return (
      <div className="border border-[#F59E0B]/30 bg-[#111827]">
        <div className="px-4 py-3 border-b border-[#F59E0B]/20 flex items-center gap-2 bg-[#F59E0B]/5">
          <Bot className="w-3.5 h-3.5 text-[#F59E0B]" />
          <p className="text-[10px] text-[#F59E0B] uppercase tracking-wider font-semibold">
            Agent Treasury Request — On-chain Submission Failed
          </p>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-[#9CA3AF]">
            The agent determined funding is required but the on-chain transaction failed.
            The credential was still recorded. You can create this spend request manually
            via the Treasury page.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-[#6B7280] mb-1">Intended Amount</p>
              <p className="text-xs font-semibold text-[#F9FAFB]">{decision.amountEth} ETH</p>
            </div>
            <div>
              <p className="text-[10px] text-[#6B7280] mb-1">Origin</p>
              <div className="flex items-center gap-1">
                <Bot className="w-3 h-3 text-[#3B82F6]" />
                <span className="text-[10px] text-[#3B82F6]">Agent-generated</span>
              </div>
            </div>
          </div>
          {decision.purpose && (
            <div>
              <p className="text-[10px] text-[#6B7280] mb-1">Intended Purpose</p>
              <p className="text-xs font-mono text-[#9CA3AF] bg-[#0B0F1A] border border-[#1F2937] px-3 py-2">
                {decision.purpose}
              </p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-[#6B7280] mb-1">Agent Rationale</p>
            <p className="text-xs text-[#9CA3AF] italic">"{decision.rationale}"</p>
          </div>
          {decision.onchainError && (
            <div className="border border-[#EF4444]/20 bg-[#EF4444]/5 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 text-[#EF4444] mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-[#EF4444] font-mono break-all">{decision.onchainError}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── State: no request (agent declined or guard blocked) ─────────────────────
  return (
    <div className="border border-[#1F2937] bg-[#111827]">
      <div className="px-4 py-3 border-b border-[#1F2937] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-[#6B7280]" />
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wider font-semibold">
            Agent Treasury Decision — No Request
          </p>
        </div>
        <SkipReasonBadge reason={decision.skipReason} />
      </div>
      <div className="p-4 space-y-2">
        <div>
          <p className="text-[10px] text-[#6B7280] mb-1">Agent Rationale</p>
          <p className="text-xs text-[#9CA3AF] leading-relaxed">
            {decision.rationale || decision.skipDetail}
          </p>
        </div>
        {decision.skipDetail && decision.skipDetail !== decision.rationale && (
          <div>
            <p className="text-[10px] text-[#6B7280] mb-1">Detail</p>
            <p className="text-xs text-[#6B7280]">{decision.skipDetail}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Treasury Decision list indicator ─────────────────────────────────────────
//
// Compact cell shown in the reports list table.

function TreasuryCell({ decision }: { decision?: TreasuryDecision }) {
  if (!decision) return <span className="text-[#374151] text-xs">—</span>

  if (decision.requiresFunding && decision.spendRequestId !== undefined) {
    return (
      <div className="flex items-center gap-1">
        <Landmark className="w-3 h-3 text-[#10B981]" />
        <span className="text-[10px] text-[#10B981] font-mono">#{decision.spendRequestId}</span>
      </div>
    )
  }

  if (decision.requiresFunding && !decision.spendRequestId) {
    return (
      <div className="flex items-center gap-1" title="Agent wanted to request funds but tx failed">
        <AlertTriangle className="w-3 h-3 text-[#F59E0B]" />
        <span className="text-[10px] text-[#F59E0B]">Failed</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1" title={decision.skipDetail}>
      <XCircle className="w-3 h-3 text-[#374151]" />
      <span className="text-[10px] text-[#6B7280]">None</span>
    </div>
  )
}

// ─── Report detail ────────────────────────────────────────────────────────────

function ReportDetail({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useReport(id)
  const [showRaw, setShowRaw] = useState(false)
  const [showPayload, setShowPayload] = useState(false)

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState message={(error as Error).message} retry={refetch} />

  const report = data?.report
  if (!report) return <ErrorState message="Report not found" />

  const { evaluation, agentOutput, evidence, task, txHash } = report

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="border border-[#1F2937] bg-[#111827] p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#F9FAFB]">{task.title}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-[#6B7280]">{TASK_TYPE_LABEL[task.taskType]}</span>
              <span className="text-[#374151]">·</span>
              <span className="text-xs font-mono text-[#6B7280]">{truncateAddress(report.agentAddress)}</span>
              <span className="text-[#374151]">·</span>
              <span className="text-xs text-[#6B7280]">{formatDateTime(report.createdAt)}</span>
            </div>
          </div>
          <div className={`text-3xl font-bold tabular-nums ${scoreColor(evaluation.score)}`}>
            {evaluation.score}
            <span className="text-sm text-[#6B7280] font-normal">/100</span>
          </div>
        </div>

        {txHash && (
          <div className="mt-3 flex items-center gap-2 border-t border-[#1F2937] pt-3">
            <Shield className="w-3 h-3 text-[#10B981]" />
            <span className="text-xs text-[#6B7280]">Onchain credential</span>
            <a
              href={arbiscanTx(txHash)}
              target="_blank" rel="noreferrer"
              className="text-xs font-mono text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-1"
            >
              {shortenHash(txHash)} <ArrowUpRight className="w-3 h-3" />
            </a>
            {report.completedTasksOnchain !== undefined && (
              <span className="text-xs text-[#6B7280] ml-2">
                Task #{report.completedTasksOnchain} · avg score {report.newAverageScoreOnchain}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Evaluation breakdown ── */}
      <div className="border border-[#1F2937] bg-[#111827] p-4">
        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-4">Evaluation Breakdown</p>
        <div className="space-y-3">
          <ScoreBar label="Completeness (component coverage)" value={evaluation.breakdown.completeness} max={30} />
          <ScoreBar label="Reasoning Depth (structural markers)" value={evaluation.breakdown.structuralQuality} max={25} />
          <ScoreBar label="Actionability (decision + rationale)" value={evaluation.breakdown.confidenceCalibration} max={20} />
          <ScoreBar label="Domain Relevance (concept breadth)" value={evaluation.breakdown.taskTypeCoherence} max={25} />
        </div>

        {evaluation.keywordsFound.length > 0 && (
          <div className="mt-4 border-t border-[#1F2937] pt-4">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-2">Evaluation Evidence</p>
            <div className="flex flex-wrap gap-1.5">
              {evaluation.keywordsFound.map(kw => {
                const isMissing   = kw.startsWith('missing:')
                const isComponent = kw.startsWith('component:')
                const isReasoning = kw.startsWith('reasoning:')
                const isCluster   = kw.startsWith('cluster:')
                const label = kw.split(':').slice(1).join(':')
                return (
                  <span key={kw} className={`text-[10px] px-1.5 py-0.5 border rounded-sm ${
                    isMissing   ? 'border-[#EF4444]/30 text-[#EF4444]/70 bg-[#EF4444]/5' :
                    isComponent ? 'border-[#10B981]/30 text-[#10B981] bg-[#10B981]/5' :
                    isReasoning ? 'border-[#3B82F6]/30 text-[#3B82F6] bg-[#3B82F6]/5' :
                    isCluster   ? 'border-[#F59E0B]/30 text-[#F59E0B] bg-[#F59E0B]/5' :
                    'border-[#374151] text-[#6B7280]'
                  }`}>{label}</span>
                )
              })}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-[#6B7280]">
              <span className="text-[#10B981]">■</span> component present
              <span className="text-[#EF4444]">■</span> component missing
              <span className="text-[#3B82F6]">■</span> reasoning marker
              <span className="text-[#F59E0B]">■</span> concept cluster
            </div>
          </div>
        )}
      </div>

      {/* ── AI output ── */}
      <div className="border border-[#1F2937] bg-[#111827]">
        <div className="px-4 py-3 border-b border-[#1F2937] flex items-center justify-between">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">AI Analysis</p>
          <div className="flex items-center gap-3 text-[10px] text-[#6B7280]">
            <span>{agentOutput.rawModel}</span>
            <span>{agentOutput.promptTokens + agentOutput.completionTokens} tokens</span>
            <span>{formatDuration(agentOutput.durationMs)}</span>
          </div>
        </div>
        <div className="p-4">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-2">Analysis</p>
          <p className="text-xs text-[#9CA3AF] leading-relaxed whitespace-pre-wrap">{agentOutput.analysis}</p>
          <div className="mt-4 pt-4 border-t border-[#1F2937]">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-2">Recommendation</p>
            <p className="text-xs text-[#F9FAFB] leading-relaxed">{agentOutput.recommendation}</p>
          </div>
          <div className="mt-3 pt-3 border-t border-[#1F2937] flex items-center gap-2">
            <span className="text-[10px] text-[#6B7280]">LLM confidence score:</span>
            <span className={`text-xs font-medium ${scoreColor(agentOutput.confidenceScore)}`}>
              {agentOutput.confidenceScore}/100
            </span>
          </div>
        </div>
      </div>

      {/* ── Treasury Decision ── */}
      {report.treasuryDecision
        ? <TreasuryDecisionPanel decision={report.treasuryDecision} />
        : (
          <div className="border border-[#1F2937] bg-[#111827] px-4 py-3 flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-[#374151]" />
            <p className="text-[10px] text-[#374151]">Treasury decision not available — report predates autonomous spend feature.</p>
          </div>
        )
      }

      {/* ── Evidence package ── */}
      <div className="border border-[#1F2937] bg-[#111827]">
        <div className="px-4 py-3 border-b border-[#1F2937]">
          <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">Evidence Package</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">keccak256(canonicalJSON) — independently verifiable</p>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-[#6B7280]">Evidence Hash</p>
              <CopyButton text={evidence.evidenceHash} />
            </div>
            <p className="text-xs font-mono text-[#F9FAFB] break-all">{evidence.evidenceHash}</p>
          </div>
          <div className="border-t border-[#1F2937] pt-3">
            <button
              onClick={() => setShowPayload(v => !v)}
              className="text-xs text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-1"
            >
              {showPayload ? 'Hide' : 'Show'} canonical payload
              <ChevronRight className={`w-3 h-3 transition-transform ${showPayload ? 'rotate-90' : ''}`} />
            </button>
            {showPayload && (
              <div className="mt-2 flex items-start gap-2">
                <pre className="text-[10px] font-mono text-[#9CA3AF] bg-[#0B0F1A] border border-[#1F2937] p-3 flex-1 overflow-auto">
                  {JSON.stringify(JSON.parse(evidence.canonicalPayload), null, 2)}
                </pre>
                <CopyButton text={evidence.canonicalPayload} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Raw JSON ── */}
      <div>
        <button
          onClick={() => setShowRaw(v => !v)}
          className="text-xs text-[#6B7280] hover:text-[#9CA3AF] flex items-center gap-1 mb-2"
        >
          {showRaw ? 'Hide' : 'Show'} raw report JSON
          <ChevronRight className={`w-3 h-3 transition-transform ${showRaw ? 'rotate-90' : ''}`} />
        </button>
        {showRaw && (
          <pre className="text-[10px] font-mono text-[#6B7280] bg-[#0B0F1A] border border-[#1F2937] p-4 overflow-auto max-h-64">
            {JSON.stringify(report, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

// ─── Reports list ─────────────────────────────────────────────────────────────

function ReportsList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useReports()
  const reports = data?.reports ?? []

  if (isLoading) return (
    <div className="space-y-px">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border border-[#1F2937] bg-[#111827] h-16 animate-pulse" />
      ))}
    </div>
  )

  if (error) return <ErrorState message={(error as Error).message} retry={refetch} />
  if (reports.length === 0) return <EmptyState message="No reports yet. Execute a task to generate the first report." />

  return (
    <div className="border border-[#1F2937]">
      <table>
        <thead>
          <tr className="border-b border-[#1F2937]">
            {['Score', 'Task', 'Type', 'Agent', 'Treasury', 'Credential Tx', 'Date', ''].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reports.map((report: Report, i) => (
            <tr
              key={report.id}
              className={`cursor-pointer hover:bg-[#1A2235] transition-colors ${i > 0 ? 'border-t border-[#1F2937]' : ''}`}
              onClick={() => onSelect(report.id)}
            >
              <td className="px-4 py-3">
                <span className={`text-sm font-semibold tabular-nums ${scoreColor(report.evaluation.score)}`}>
                  {report.evaluation.score}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-[#F9FAFB] max-w-[160px] truncate">{report.task.title}</td>
              <td className="px-4 py-3 text-xs text-[#9CA3AF]">{TASK_TYPE_LABEL[report.task.taskType]}</td>
              <td className="px-4 py-3 text-xs font-mono text-[#6B7280]">{truncateAddress(report.agentAddress)}</td>
              <td className="px-4 py-3">
                <TreasuryCell decision={report.treasuryDecision} />
              </td>
              <td className="px-4 py-3">
                {report.txHash
                  ? <a href={arbiscanTx(report.txHash)} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] font-mono text-[#3B82F6] hover:underline flex items-center gap-0.5">
                      {shortenHash(report.txHash, 6)} <ArrowUpRight className="w-2.5 h-2.5" />
                    </a>
                  : <span className="text-[#374151] text-xs">—</span>
                }
              </td>
              <td className="px-4 py-3 text-xs text-[#6B7280]">{formatDateTime(report.createdAt)}</td>
              <td className="px-4 py-3">
                <ChevronRight className="w-3.5 h-3.5 text-[#374151]" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Reports page ─────────────────────────────────────────────────────────────

export function Reports() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()

  if (id) {
    return (
      <Page
        title="Report Detail"
        action={
          <button onClick={() => navigate('/reports')} className="text-xs text-[#6B7280] hover:text-[#F9FAFB]">
            ← All reports
          </button>
        }
      >
        <ReportDetail id={id} />
      </Page>
    )
  }

  return (
    <Page title="Reports" description="Evaluation reports — credential evidence and autonomous treasury decisions">
      <ReportsList onSelect={id => navigate(`/reports/${id}`)} />
    </Page>
  )
}
