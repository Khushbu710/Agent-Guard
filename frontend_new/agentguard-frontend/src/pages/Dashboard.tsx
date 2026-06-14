import { Link } from 'react-router-dom'
import { ArrowUpRight, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react'
import { Page } from '../components/layout/Page'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/primitives'
import { useTasks, useReports, useSpend, useHealth } from '../hooks'
import {
  truncateAddress, formatWei, formatDateTime,
  statusBadgeClass, spendStatusBadgeClass, shortenHash, arbiscanTx,
} from '../lib/utils'
import type { Task, Report, SpendRequest } from '../types'
import { TASK_TYPE_LABEL } from '../types'

function TaskStatusIcon({ status }: { status: Task['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-[#EF4444]" />
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-[#3B82F6] animate-spin" />
  return <Clock className="w-3.5 h-3.5 text-[#6B7280]" />
}

export function Dashboard() {
  const { data: tasksData } = useTasks()
  const { data: reportsData } = useReports()
  const { data: spendData } = useSpend()
  const { data: health } = useHealth()

  const tasks = tasksData?.tasks ?? []
  const reports = reportsData?.reports ?? []
  const spend = spendData?.spendRequests ?? []

  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const pendingSpend = spend.filter(s => s.status === 0).length
  const approvedSpend = spend.filter(s => s.status === 1).length

  const totalReleasedWei = spend
    .filter(s => s.status === 2)
    .reduce((acc, s) => acc + BigInt(s.amount), 0n)

  const recentTasks = [...tasks].slice(0, 6)
  const recentReports = [...reports].slice(0, 4)

  return (
    <Page
      title="Protocol Overview"
      description="AgentGuard trust framework — Arbitrum Sepolia"
    >
      {/* ── Status banner ─────────────────────────────────────────────────── */}
      <div className="border border-[#1F2937] bg-[#111827] px-4 py-2.5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-[#6B7280]">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${health?.blockchain.connected ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
            <span>RPC {health?.blockchain.connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          {health?.blockchain.chainId && (
            <span>Chain {health.blockchain.chainId}</span>
          )}
          {health?.contract && (
            <span className="font-mono">{truncateAddress(health.contract)}</span>
          )}
        </div>
        {health?.blockchain.blockNumber && (
          <span className="text-xs text-[#6B7280] font-mono">
            #{health.blockchain.blockNumber.toLocaleString()}
          </span>
        )}
      </div>

      {/* ── Stat grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1F2937] mb-6">
        <StatCard
          label="Total Tasks"
          value={tasks.length}
          sub={`${completedTasks} completed`}
        />
        <StatCard
          label="Reports Generated"
          value={reports.length}
          sub="Onchain credentials"
          accent
        />
        <StatCard
          label="Pending Requests"
          value={pendingSpend}
          sub={`${approvedSpend} approved`}
        />
        <StatCard
          label="Total Released"
          value={formatWei(totalReleasedWei.toString())}
          sub="Executed spend"
        />
      </div>

      {/* ── Two-column activity ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent tasks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">Recent Tasks</h2>
            <Link to="/tasks" className="text-xs text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-1">
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="border border-[#1F2937]">
            {recentTasks.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6B7280]">No tasks yet</div>
            ) : (
              recentTasks.map((task, i) => (
                <Link
                  key={task.id}
                  to={`/tasks`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-[#1A2235] transition-colors ${i > 0 ? 'border-t border-[#1F2937]' : ''}`}
                >
                  <TaskStatusIcon status={task.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#F9FAFB] truncate">{task.title}</p>
                    <p className="text-[10px] text-[#6B7280]">{TASK_TYPE_LABEL[task.taskType]}</p>
                  </div>
                  <Badge className={statusBadgeClass(task.status)}>
                    {task.status}
                  </Badge>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent reports */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">Recent Reports</h2>
            <Link to="/reports" className="text-xs text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-1">
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="border border-[#1F2937]">
            {recentReports.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6B7280]">No reports yet — execute a task to generate one</div>
            ) : (
              recentReports.map((report: Report, i) => (
                <Link
                  key={report.id}
                  to={`/reports/${report.id}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-[#1A2235] transition-colors ${i > 0 ? 'border-t border-[#1F2937]' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${report.evaluation.score >= 75 ? 'text-[#10B981]' : report.evaluation.score >= 50 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                        {report.evaluation.score}
                      </span>
                      <p className="text-xs text-[#F9FAFB] truncate">{report.task.title}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[#6B7280] font-mono">
                        {truncateAddress(report.agentAddress)}
                      </span>
                      {report.txHash && (
                        <a
                          href={arbiscanTx(report.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-[10px] text-[#3B82F6] hover:underline font-mono flex items-center gap-0.5"
                        >
                          {shortenHash(report.txHash, 6)} <ArrowUpRight className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-[#6B7280]">{formatDateTime(report.createdAt)}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Spend summary ─────────────────────────────────────────────────── */}
      {spend.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">Spend Requests</h2>
            <Link to="/treasury" className="text-xs text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-1">
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="border border-[#1F2937]">
            <table>
              <thead>
                <tr className="border-b border-[#1F2937]">
                  {['ID', 'Agent', 'Amount', 'Purpose', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spend.slice(0, 5).map((req: SpendRequest) => (
                  <tr key={req.requestId} className="border-b border-[#1F2937] hover:bg-[#1A2235] transition-colors">
                    <td className="px-4 py-3 text-xs font-mono text-[#6B7280]">#{req.requestId}</td>
                    <td className="px-4 py-3 text-xs font-mono text-[#9CA3AF]">{truncateAddress(req.agent)}</td>
                    <td className="px-4 py-3 text-xs text-[#F9FAFB]">{formatWei(req.amount)}</td>
                    <td className="px-4 py-3 text-xs text-[#9CA3AF] max-w-[180px] truncate">{req.purpose}</td>
                    <td className="px-4 py-3">
                      <Badge className={spendStatusBadgeClass(req.status)}>{req.statusLabel}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  )
}
