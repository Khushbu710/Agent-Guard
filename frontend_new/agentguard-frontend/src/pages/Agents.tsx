import { useState } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import { ethers } from 'ethers'
import { Page } from '../components/layout/Page'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/primitives'
import { ErrorState, PageLoader, EmptyState } from '../components/ui/primitives'
import { useAgent, useAgentSummary } from '../hooks'
import {
  truncateAddress, formatWei, formatDateTime,
  credentialColor,
} from '../lib/utils'
import { TASK_TYPE_LABEL } from '../types'

// ─── Credential progress indicator (signature element) ───────────────────────
//
// Shows the agent's position on the Bronze → Silver → Gold credential path.
// Each tier has two requirements: min tasks and min average score.
// The bar renders both dimensions as a two-axis compact progress display.

function CredentialProgress({ completedTasks, averageScore, credentialLevel }: {
  completedTasks: number
  averageScore: number
  credentialLevel: number
}) {
  const tiers = [
    { name: 'Bronze', minTasks: 3,  minScore: 60, level: 1, color: '#CD7F32' },
    { name: 'Silver', minTasks: 10, minScore: 75, level: 2, color: '#9CA3AF' },
    { name: 'Gold',   minTasks: 25, minScore: 90, level: 3, color: '#F59E0B' },
  ]

  return (
    <div className="border border-[#1F2937] bg-[#111827] p-4">
      <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-4">Credential Progression</p>
      <div className="space-y-3">
        {tiers.map(tier => {
          const tasksMet   = completedTasks >= tier.minTasks
          const scoreMet   = averageScore >= tier.minScore
          const tierActive = credentialLevel >= tier.level

          return (
            <div key={tier.name}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: tierActive ? tier.color : '#374151' }}
                  >
                    {tier.name}
                  </span>
                  {tierActive && (
                    <span className="text-[9px] border px-1 py-0.5 rounded-sm"
                      style={{ color: tier.color, borderColor: `${tier.color}40` }}>
                      Active
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-[#6B7280]">
                  {tier.minTasks} tasks · {tier.minScore} avg score
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {/* Tasks bar */}
                <div>
                  <div className="flex justify-between text-[9px] text-[#6B7280] mb-0.5">
                    <span>Tasks</span>
                    <span className={tasksMet ? 'text-[#10B981]' : ''}>
                      {completedTasks}/{tier.minTasks}
                    </span>
                  </div>
                  <div className="h-1 bg-[#1F2937] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (completedTasks / tier.minTasks) * 100)}%`,
                        backgroundColor: tasksMet ? tier.color : '#374151',
                      }}
                    />
                  </div>
                </div>
                {/* Score bar */}
                <div>
                  <div className="flex justify-between text-[9px] text-[#6B7280] mb-0.5">
                    <span>Avg Score</span>
                    <span className={scoreMet ? 'text-[#10B981]' : ''}>
                      {averageScore}/{tier.minScore}
                    </span>
                  </div>
                  <div className="h-1 bg-[#1F2937] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (averageScore / tier.minScore) * 100)}%`,
                        backgroundColor: scoreMet ? tier.color : '#374151',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Agent profile panel ──────────────────────────────────────────────────────

function AgentPanel({ address }: { address: string }) {
  const { data: agentData, isLoading: agentLoading, error: agentError, refetch } = useAgent(address)
  const { data: summaryData } = useAgentSummary(address)

  if (agentLoading) return <PageLoader />
  if (agentError) return <ErrorState message={(agentError as Error).message} retry={refetch} />

  if (!agentData) return <ErrorState message="Agent not found on contract" />

  const onchain = agentData.agent.onchain
  const summary = summaryData?.summary

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border border-[#1F2937] bg-[#111827] p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#F9FAFB]">{onchain.name}</h2>
            <p className="text-xs font-mono text-[#6B7280] mt-0.5">{address}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${credentialColor(onchain.credentialLevel)}`}>
              {onchain.credentialLevelLabel}
            </span>
            <a
              href={`https://sepolia.arbiscan.io/address/${address}`}
              target="_blank" rel="noreferrer"
              className="text-[#6B7280] hover:text-[#9CA3AF]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2">
          <span className="text-[10px] text-[#6B7280]">Owner:</span>
          <span className="text-[10px] font-mono text-[#9CA3AF]">{truncateAddress(onchain.owner)}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1F2937]">
        <StatCard label="Completed Tasks" value={onchain.completedTasks} />
        <StatCard label="Average Score" value={onchain.averageScore}
          sub={`/${100}`} />
        <StatCard label="Total Released" value={formatWei(onchain.totalReleasedWei)} />
        <StatCard label="Pending Requests" value={onchain.pendingCount} />
      </div>

      {/* Credential progress + treasury limits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CredentialProgress
          completedTasks={onchain.completedTasks}
          averageScore={onchain.averageScore}
          credentialLevel={onchain.credentialLevel}
        />

        {summary && (
          <div className="border border-[#1F2937] bg-[#111827] p-4">
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-3">Treasury Permissions</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#6B7280]">Spend limit (per request)</span>
                <span className="text-[#F9FAFB] font-medium">{formatWei(summary.spendLimit)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#6B7280]">Max concurrent requests</span>
                <span className="text-[#F9FAFB] font-medium">{summary.pendingLimit}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#6B7280]">Available treasury</span>
                <span className="text-[#10B981] font-medium">{formatWei(summary.availableTreasury)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Task history */}
      {agentData.agent.backendTaskHistory && agentData.agent.backendTaskHistory.length > 0 && (
        <div className="border border-[#1F2937]">
          <div className="px-4 py-2.5 border-b border-[#1F2937]">
            <h3 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">Task History</h3>
          </div>
          <table>
            <thead>
              <tr className="border-b border-[#1F2937]">
                {['Title', 'Type', 'Status', 'Created'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agentData.agent.backendTaskHistory.map((task: import('../types').Task, i: number) => (
                <tr key={task.id} className={`hover:bg-[#1A2235] transition-colors ${i > 0 ? 'border-t border-[#1F2937]' : ''}`}>
                  <td className="px-4 py-3 text-xs text-[#F9FAFB]">{task.title}</td>
                  <td className="px-4 py-3 text-xs text-[#9CA3AF]">{TASK_TYPE_LABEL[task.taskType]}</td>
                  <td className="px-4 py-3">
                    <Badge className={
                      task.status === 'completed' ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' :
                      task.status === 'failed' ? 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20' :
                      'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/20'
                    }>{task.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6B7280]">{formatDateTime(task.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Agents page ──────────────────────────────────────────────────────────────

export function Agents() {
  const [input, setInput] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  function handleLookup() {
    setError('')
    if (!input.trim()) { setError('Enter an agent address'); return }
    if (!ethers.isAddress(input.trim())) { setError('Not a valid Ethereum address'); return }
    setAddress(input.trim())
  }

  return (
    <Page title="Agents" description="Look up any registered AgentGuard agent by address">
      {/* Search bar */}
      <div className="border border-[#1F2937] bg-[#111827] p-4 mb-6">
        <label className="text-xs text-[#6B7280] mb-2 block">Agent Address</label>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="0x…"
            className="flex-1 bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm font-mono text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm"
          />
          <button
            onClick={handleLookup}
            className="flex items-center gap-2 px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-sm font-medium transition-colors rounded-sm"
          >
            <Search className="w-3.5 h-3.5" />
            Look up
          </button>
        </div>
        {error && <p className="text-xs text-[#EF4444] mt-2">{error}</p>}
      </div>

      {address
        ? <AgentPanel address={address} />
        : <EmptyState message="Enter an agent address above to view their credential profile, task history, and treasury permissions." />
      }
    </Page>
  )
}
