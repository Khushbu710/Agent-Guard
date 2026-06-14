import { useState } from 'react'
import { Play, Plus, X, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Page } from '../components/layout/Page'
import { Badge, ErrorState, EmptyState } from '../components/ui/primitives'
import { useTasks, useCreateTask, useExecuteTask } from '../hooks'
import { formatDateTime, statusBadgeClass, truncateAddress } from '../lib/utils'
import type { Task, TaskType, CreateTaskInput } from '../types'
import { TASK_TYPE_LABEL } from '../types'

const TASK_TYPES: TaskType[] = ['TreasuryAnalysis', 'GovernanceReview', 'RiskAssessment']

// ─── Create task form ─────────────────────────────────────────────────────────

function CreateTaskForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateTaskInput>({
    title: '',
    description: '',
    taskType: 'TreasuryAnalysis',
    agentAddress: '',
  })

  const createTask = useCreateTask()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createTask.mutateAsync(form)
      onClose()
    } catch {
      // error shown inline
    }
  }

  return (
    <div className="border border-[#1F2937] bg-[#111827] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">New Task</h2>
        <button onClick={onClose} className="text-[#6B7280] hover:text-[#F9FAFB]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-[#6B7280] uppercase tracking-wider block mb-1.5">Title</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Q3 Treasury Rebalance Review"
              className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm"
            />
          </div>

          <div>
            <label className="text-[10px] text-[#6B7280] uppercase tracking-wider block mb-1.5">Task Type</label>
            <select
              value={form.taskType}
              onChange={e => setForm(f => ({ ...f, taskType: e.target.value as TaskType }))}
              className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm text-[#F9FAFB] focus:outline-none focus:border-[#3B82F6] rounded-sm"
            >
              {TASK_TYPES.map(t => (
                <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-[#6B7280] uppercase tracking-wider block mb-1.5">Description</label>
          <textarea
            required
            rows={4}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe the task in detail. Include relevant context, constraints, and goals for the AI agent to analyze…"
            className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm resize-none"
          />
        </div>

        <div>
          <label className="text-[10px] text-[#6B7280] uppercase tracking-wider block mb-1.5">Agent Address</label>
          <input
            required
            value={form.agentAddress}
            onChange={e => setForm(f => ({ ...f, agentAddress: e.target.value }))}
            placeholder="0x…"
            className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm font-mono text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm"
          />
          <p className="text-[10px] text-[#6B7280] mt-1">The agent must be registered on the AgentGuard contract.</p>
        </div>

        {createTask.error && (
          <p className="text-xs text-[#EF4444]">{(createTask.error as Error).message}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={createTask.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white text-sm font-medium transition-colors rounded-sm"
          >
            {createTask.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create Task
          </button>
          <button type="button" onClick={onClose} className="text-sm text-[#6B7280] hover:text-[#F9FAFB]">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Task row with expandable execute ─────────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false)
  const executeTask = useExecuteTask()

  async function handleExecute() {
    if (!task.agentAddress) return
    await executeTask.mutateAsync({ id: task.id, agentAddress: task.agentAddress })
  }

  const canExecute = task.status === 'pending' && !!task.agentAddress
  const isExecuting = executeTask.isPending && executeTask.variables?.id === task.id

  return (
    <>
      <tr
        className="border-b border-[#1F2937] hover:bg-[#1A2235] transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3 text-xs font-mono text-[#6B7280]">{task.id.slice(0, 8)}…</td>
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-[#F9FAFB]">{task.title}</p>
        </td>
        <td className="px-4 py-3 text-xs text-[#9CA3AF]">{TASK_TYPE_LABEL[task.taskType]}</td>
        <td className="px-4 py-3">
          <Badge className={statusBadgeClass(task.status)}>
            {task.status === 'running'
              ? <><Loader2 className="w-2.5 h-2.5 animate-spin mr-1 inline" />running</>
              : task.status}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs text-[#6B7280] font-mono">
          {task.agentAddress ? truncateAddress(task.agentAddress) : <span className="text-[#374151]">—</span>}
        </td>
        <td className="px-4 py-3 text-xs text-[#6B7280]">{formatDateTime(task.createdAt)}</td>
        <td className="px-4 py-3 text-right">
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[#6B7280] ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] ml-auto" />}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[#1F2937] bg-[#0D1424]">
          <td colSpan={7} className="px-4 py-4">
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-1">Description</p>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">{task.description}</p>
              </div>

              {task.error && (
                <div className="border border-[#EF4444]/20 bg-[#EF4444]/5 px-3 py-2">
                  <p className="text-xs text-[#EF4444]"><XCircle className="w-3 h-3 inline mr-1" />{task.error}</p>
                </div>
              )}

              {task.reportId && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                  <span className="text-xs text-[#6B7280]">Report:</span>
                  <a href={`/reports/${task.reportId}`} className="text-xs text-[#3B82F6] font-mono hover:underline">
                    {task.reportId.slice(0, 16)}…
                  </a>
                </div>
              )}

              {canExecute && (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={e => { e.stopPropagation(); handleExecute() }}
                    disabled={isExecuting}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white text-xs font-medium transition-colors rounded-sm"
                  >
                    {isExecuting
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Executing…</>
                      : <><Play className="w-3 h-3" />Execute Task</>
                    }
                  </button>
                  <span className="text-[10px] text-[#6B7280]">Runs AI analysis → evaluation → onchain credential</span>
                </div>
              )}

              {executeTask.error && executeTask.variables?.id === task.id && (
                <p className="text-xs text-[#EF4444]">{(executeTask.error as Error).message}</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Tasks page ───────────────────────────────────────────────────────────────

export function Tasks() {
  const [showForm, setShowForm] = useState(false)
  const { data, isLoading, error, refetch } = useTasks()
  const tasks = data?.tasks ?? []

  return (
    <Page
      title="Tasks"
      description="Create, manage, and execute AI agent tasks"
      action={
        !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-medium transition-colors rounded-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Task
          </button>
        )
      }
    >
      {showForm && <CreateTaskForm onClose={() => setShowForm(false)} />}

      <div className="border border-[#1F2937]">
        {/* Table header */}
        <div className="border-b border-[#1F2937] px-4 py-2.5 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">
            All Tasks <span className="text-[#6B7280] font-normal ml-1">({tasks.length})</span>
          </h2>
          <div className="flex gap-3 text-[10px] text-[#6B7280]">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-[#10B981]" />{tasks.filter(t => t.status === 'completed').length} completed</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-[#6B7280]" />{tasks.filter(t => t.status === 'pending').length} pending</span>
          </div>
        </div>

        {error ? (
          <ErrorState message={(error as Error).message} retry={refetch} />
        ) : (
          <table>
            <thead>
              <tr className="border-b border-[#1F2937]">
                {['ID', 'Title', 'Type', 'Status', 'Agent', 'Created', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#1F2937]">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3.5 bg-[#1F2937] rounded animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : tasks.length === 0 ? (
                <tr><td colSpan={7}><EmptyState message="No tasks yet. Create one to get started." /></td></tr>
              ) : (
                tasks.map(task => <TaskRow key={task.id} task={task} />)
              )}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  )
}
