import { useState } from 'react'
import { ethers } from 'ethers'
import {
  ArrowUpRight, CircleDot, CheckCircle2, XCircle,
  Clock, Ban, Loader2, ChevronDown, ChevronUp,
  AlertTriangle,
} from 'lucide-react'
import { Page } from '../components/layout/Page'
import { StatCard } from '../components/ui/StatCard'
import { Badge, ErrorState, EmptyState, PageLoader } from '../components/ui/primitives'
import {
  useSpend, useHealth, useTreasuryBalance,
  useDepositTreasury, useCreateSpendRequest,
  useApproveRequest, useRejectRequest, useCancelRequest, useExecuteRequest,
} from '../hooks'
import {
  truncateAddress, formatWei, formatTimestamp,
  spendStatusBadgeClass, arbiscanTx,
} from '../lib/utils'
import type { SpendRequest } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: number }) {
  if (status === 0) return <Clock      className="w-3.5 h-3.5 text-[#F59E0B]" />
  if (status === 1) return <CircleDot  className="w-3.5 h-3.5 text-[#3B82F6]" />
  if (status === 2) return <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
  if (status === 3) return <XCircle    className="w-3.5 h-3.5 text-[#EF4444]" />
  return               <Ban         className="w-3.5 h-3.5 text-[#6B7280]" />
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={arbiscanTx(hash)}
      target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-[10px] font-mono text-[#3B82F6] hover:text-[#60A5FA]"
    >
      {hash.slice(0, 10)}… <ArrowUpRight className="w-2.5 h-2.5" />
    </a>
  )
}

// Inline feedback row shown under an action button after mutation settles
function ActionFeedback({
  isPending, error, txHash, label,
}: {
  isPending: boolean
  error: Error | null
  txHash?: string
  label: string
}) {
  if (isPending) return (
    <span className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
      <Loader2 className="w-3 h-3 animate-spin" /> {label}…
    </span>
  )
  if (error) return (
    <span className="flex items-center gap-1 text-[10px] text-[#EF4444]">
      <AlertTriangle className="w-3 h-3" />
      {error.message.slice(0, 80)}
    </span>
  )
  if (txHash) return (
    <span className="flex items-center gap-1 text-[10px] text-[#10B981]">
      <CheckCircle2 className="w-3 h-3" /> Confirmed · <TxLink hash={txHash} />
    </span>
  )
  return null
}

// ─── Treasury Balance card ─────────────────────────────────────────────────────

function TreasuryBalanceCard() {
  const { data, isLoading, error, refetch } = useTreasuryBalance()

  if (isLoading) return (
    <div className="border border-[#1F2937] bg-[#111827] p-4 animate-pulse h-28" />
  )
  if (error) return (
    <div className="border border-[#1F2937] bg-[#111827] p-4">
      <ErrorState message={(error as Error).message} retry={refetch} />
    </div>
  )

  const b = data?.balance
  if (!b) return null

  const totalBig   = BigInt(b.totalBalanceWei)
  // availBig available via b.availableWei
  const escrowBig  = BigInt(b.escrowedWei)

  // Escrow % of total — for the visual utilisation bar
  const escrowPct = totalBig > 0n
    ? Number((escrowBig * 10000n) / totalBig) / 100
    : 0

  return (
    <div className="border border-[#1F2937] bg-[#111827] p-4">
      <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-3">Contract Balance</p>

      {/* Main balance */}
      <p className="text-2xl font-semibold text-[#F9FAFB] tabular-nums">
        {formatWei(b.totalBalanceWei)}
      </p>
      <p className="text-[10px] text-[#6B7280] mt-0.5">Total contract balance</p>

      {/* Breakdown */}
      <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#1F2937]">
        <div>
          <p className="text-[10px] text-[#6B7280] mb-0.5">Available</p>
          <p className="text-sm font-semibold text-[#10B981] tabular-nums">{formatWei(b.availableWei)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#6B7280] mb-0.5">Escrowed (approved)</p>
          <p className="text-sm font-semibold text-[#3B82F6] tabular-nums">{formatWei(b.escrowedWei)}</p>
        </div>
      </div>

      {/* Utilisation bar */}
      {escrowPct > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-[9px] text-[#6B7280] mb-1">
            <span>Escrow utilisation</span>
            <span>{escrowPct.toFixed(1)}%</span>
          </div>
          <div className="h-1 bg-[#1F2937] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#3B82F6] rounded-full"
              style={{ width: `${Math.min(100, escrowPct)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Deposit card ─────────────────────────────────────────────────────────────

function DepositCard() {
  const [amount, setAmount] = useState('')
  const deposit = useDepositTreasury()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = amount.trim()
    if (!trimmed || isNaN(Number(trimmed)) || Number(trimmed) <= 0) return
    try {
      await deposit.mutateAsync(trimmed)
      setAmount('')
    } catch { /* shown via deposit.error */ }
  }

  const isValid = amount.trim() !== '' && !isNaN(Number(amount.trim())) && Number(amount.trim()) > 0

  return (
    <div className="border border-[#1F2937] bg-[#111827] p-4">
      <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-3">Fund Treasury</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[10px] text-[#6B7280] block mb-1.5">Amount (ETH)</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm font-mono"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">ETH</span>
            </div>
            <button
              type="submit"
              disabled={!isValid || deposit.isPending}
              className="px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors rounded-sm whitespace-nowrap flex items-center gap-1.5"
            >
              {deposit.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Deposit Treasury
            </button>
          </div>
          <p className="text-[10px] text-[#6B7280] mt-1">
            Backend signer must be the contract owner and hold sufficient ETH.
          </p>
        </div>

        {/* Feedback */}
        <div className="min-h-[16px]">
          <ActionFeedback
            isPending={deposit.isPending}
            error={deposit.error as Error | null}
            txHash={(deposit.data as any)?.txHash}
            label="Depositing"
          />
          {deposit.isSuccess && deposit.data && (
            <span className="text-[10px] text-[#10B981]">
              Deposited {deposit.data.depositedEth} ETH ·{' '}
              New balance {formatWei(deposit.data.newBalanceWei)}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

// ─── Create Spend Request card ────────────────────────────────────────────────

function CreateRequestCard() {
  const [form, setForm] = useState({ agentAddress: '', amountEth: '', purpose: '' })
  const [fieldError, setFieldError] = useState('')
  const create = useCreateSpendRequest()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFieldError('')

    if (!ethers.isAddress(form.agentAddress.trim())) {
      setFieldError('Agent address is not a valid Ethereum address')
      return
    }
    const amt = Number(form.amountEth.trim())
    if (isNaN(amt) || amt <= 0) {
      setFieldError('Amount must be a positive number')
      return
    }
    if (!form.purpose.trim()) {
      setFieldError('Purpose is required')
      return
    }

    try {
      await create.mutateAsync({
        agentAddress: form.agentAddress.trim(),
        amountEth: form.amountEth.trim(),
        purpose: form.purpose.trim(),
      })
      setForm({ agentAddress: '', amountEth: '', purpose: '' })
    } catch { /* shown via create.error */ }
  }

  return (
    <div className="border border-[#1F2937] bg-[#111827] p-4">
      <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-3">Create Spend Request</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[10px] text-[#6B7280] block mb-1.5">Agent Address</label>
          <input
            value={form.agentAddress}
            onChange={e => setForm(f => ({ ...f, agentAddress: e.target.value }))}
            placeholder="0x…"
            className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-xs font-mono text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm"
          />
        </div>

        <div>
          <label className="text-[10px] text-[#6B7280] block mb-1.5">Amount (ETH)</label>
          <div className="relative">
            <input
              type="text"
              value={form.amountEth}
              onChange={e => setForm(f => ({ ...f, amountEth: e.target.value }))}
              placeholder="0.0"
              className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-sm font-mono text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">ETH</span>
          </div>
          <p className="text-[10px] text-[#6B7280] mt-1">
            Must be within the agent's credential spend limit.
          </p>
        </div>

        <div>
          <label className="text-[10px] text-[#6B7280] block mb-1.5">Purpose</label>
          <textarea
            rows={3}
            value={form.purpose}
            onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
            placeholder="Describe the intended use of funds…"
            className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-xs text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#3B82F6] rounded-sm resize-none"
          />
        </div>

        {(fieldError || create.error) && (
          <p className="text-[10px] text-[#EF4444] flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {fieldError || (create.error as Error)?.message}
          </p>
        )}

        <div className="flex items-center justify-between">
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1A2235] border border-[#1F2937] hover:border-[#3B82F6] disabled:opacity-40 text-[#F9FAFB] text-xs font-medium transition-colors rounded-sm"
          >
            {create.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            Create Spend Request
          </button>
          {create.isSuccess && create.data && (
            <span className="text-[10px] text-[#10B981]">
              Request #{create.data.requestId} created · <TxLink hash={create.data.txHash} />
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

// ─── Reject modal (inline) ────────────────────────────────────────────────────

function RejectPanel({
  requestId,
  onClose,
}: { requestId: number; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const reject = useRejectRequest()

  async function handleReject() {
    if (!reason.trim()) return
    try {
      await reject.mutateAsync({ id: requestId, reason: reason.trim() })
      onClose()
    } catch { /* shown inline */ }
  }

  return (
    <div className="mt-2 border border-[#EF4444]/30 bg-[#EF4444]/5 p-3 space-y-2">
      <label className="text-[10px] text-[#9CA3AF] block">Rejection reason (stored on-chain)</label>
      <textarea
        rows={2}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Explain why this request is rejected…"
        className="w-full bg-[#0B0F1A] border border-[#1F2937] px-3 py-2 text-xs text-[#F9FAFB] placeholder-[#374151] focus:outline-none focus:border-[#EF4444] rounded-sm resize-none"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={handleReject}
          disabled={!reason.trim() || reject.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-40 text-white text-xs font-medium rounded-sm transition-colors"
        >
          {reject.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
          Confirm Reject
        </button>
        <button onClick={onClose} className="text-xs text-[#6B7280] hover:text-[#9CA3AF]">
          Cancel
        </button>
        {reject.error && (
          <span className="text-[10px] text-[#EF4444]">{(reject.error as Error).message.slice(0, 60)}</span>
        )}
      </div>
    </div>
  )
}

// ─── Spend request row with contextual actions ─────────────────────────────────

function SpendRow({ req, idx }: { req: SpendRequest; idx: number }) {
  const [expanded, setExpanded] = useState(false)
  const [showReject, setShowReject] = useState(false)

  const approve  = useApproveRequest()
  const cancel   = useCancelRequest()
  const execute  = useExecuteRequest()

  // Track last tx for each action — shown in the expanded detail
  const [lastTx, setLastTx] = useState<{ action: string; hash: string } | null>(null)

  async function handleApprove() {
    try {
      const r = await approve.mutateAsync(req.requestId)
      setLastTx({ action: 'Approved', hash: r.txHash })
    } catch { /* shown via approve.error */ }
  }

  async function handleCancel() {
    try {
      const r = await cancel.mutateAsync(req.requestId)
      setLastTx({ action: 'Cancelled', hash: r.txHash })
    } catch { /* shown via cancel.error */ }
  }

  async function handleExecute() {
    try {
      const r = await execute.mutateAsync({ id: req.requestId, agentAddress: req.agent })
      setLastTx({ action: 'Executed', hash: r.txHash })
    } catch { /* shown via execute.error */ }
  }

  const anyPending =
    approve.isPending || cancel.isPending || execute.isPending

  return (
    <>
      {/* Main row */}
      <tr
        className={`border-b border-[#1F2937] hover:bg-[#1A2235] transition-colors cursor-pointer ${idx > 0 ? '' : ''}`}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={req.status} />
            <span className="text-xs font-mono text-[#6B7280]">#{req.requestId}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs font-mono text-[#9CA3AF]">{truncateAddress(req.agent)}</td>
        <td className="px-4 py-3">
          <span className="text-sm font-semibold text-[#F9FAFB] tabular-nums">{formatWei(req.amount)}</span>
        </td>
        <td className="px-4 py-3 text-xs text-[#9CA3AF] max-w-[180px] truncate" title={req.purpose}>
          {req.purpose}
        </td>
        <td className="px-4 py-3">
          <Badge className={spendStatusBadgeClass(req.status)}>{req.statusLabel}</Badge>
        </td>
        <td className="px-4 py-3 text-xs text-[#6B7280]">{formatTimestamp(req.timestamp)}</td>
        <td className="px-4 py-3 text-right">
          {expanded
            ? <ChevronUp   className="w-3.5 h-3.5 text-[#6B7280] ml-auto" />
            : <ChevronDown className="w-3.5 h-3.5 text-[#374151] ml-auto" />}
        </td>
      </tr>

      {/* Expanded detail + actions */}
      {expanded && (
        <tr className="border-b border-[#1F2937] bg-[#0D1424]">
          <td colSpan={7} className="px-4 py-4">
            <div className="space-y-3">
              {/* Full agent address + purpose */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-[#6B7280] mb-0.5">Agent Address</p>
                  <p className="text-xs font-mono text-[#9CA3AF]">{req.agent}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#6B7280] mb-0.5">Purpose</p>
                  <p className="text-xs text-[#9CA3AF]">{req.purpose}</p>
                </div>
              </div>

              {/* Rejection reason */}
              {req.rejectionReason && (
                <div className="border border-[#EF4444]/20 bg-[#EF4444]/5 px-3 py-2">
                  <p className="text-[10px] text-[#6B7280] mb-0.5">Rejection Reason</p>
                  <p className="text-xs text-[#EF4444]">{req.rejectionReason}</p>
                </div>
              )}

              {/* Last confirmed tx */}
              {lastTx && (
                <div className="flex items-center gap-2 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 text-[#10B981]" />
                  <span className="text-[#10B981]">{lastTx.action}</span>
                  <TxLink hash={lastTx.hash} />
                </div>
              )}

              {/* ── Contextual actions ─────────────────────────────────────── */}

              {/* Pending → Approve / Reject / Cancel */}
              {req.status === 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={e => { e.stopPropagation(); handleApprove() }}
                      disabled={anyPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 text-white text-xs font-medium rounded-sm transition-colors"
                    >
                      {approve.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <CheckCircle2 className="w-3 h-3" />}
                      Approve
                    </button>

                    <button
                      onClick={e => { e.stopPropagation(); setShowReject(v => !v) }}
                      disabled={anyPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A2235] border border-[#EF4444]/40 hover:border-[#EF4444] disabled:opacity-40 text-[#EF4444] text-xs font-medium rounded-sm transition-colors"
                    >
                      <XCircle className="w-3 h-3" />
                      Reject
                    </button>

                    <button
                      onClick={e => { e.stopPropagation(); handleCancel() }}
                      disabled={anyPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A2235] border border-[#1F2937] hover:border-[#6B7280] disabled:opacity-40 text-[#6B7280] text-xs font-medium rounded-sm transition-colors"
                    >
                      {cancel.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Ban className="w-3 h-3" />}
                      Cancel
                    </button>

                    <div onClick={e => e.stopPropagation()}>
                      <ActionFeedback
                        isPending={approve.isPending}
                        error={approve.error as Error | null}
                        label="Approving"
                      />
                      <ActionFeedback
                        isPending={cancel.isPending}
                        error={cancel.error as Error | null}
                        label="Cancelling"
                      />
                    </div>
                  </div>

                  {showReject && (
                    <div onClick={e => e.stopPropagation()}>
                      <RejectPanel
                        requestId={req.requestId}
                        onClose={() => setShowReject(false)}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Approved → Execute / Cancel (protocol owner only for cancel) */}
              {req.status === 1 && (
                <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={handleExecute}
                    disabled={anyPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-40 text-white text-xs font-medium rounded-sm transition-colors"
                  >
                    {execute.isPending
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <ArrowUpRight className="w-3 h-3" />}
                    Execute · transfer {formatWei(req.amount)} to agent
                  </button>

                  <button
                    onClick={handleCancel}
                    disabled={anyPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A2235] border border-[#1F2937] hover:border-[#6B7280] disabled:opacity-40 text-[#6B7280] text-xs font-medium rounded-sm transition-colors"
                  >
                    {cancel.isPending
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Ban className="w-3 h-3" />}
                    Cancel (releases escrow)
                  </button>

                  <ActionFeedback
                    isPending={execute.isPending}
                    error={execute.error as Error | null}
                    label="Executing transfer"
                  />
                  <ActionFeedback
                    isPending={cancel.isPending}
                    error={cancel.error as Error | null}
                    label="Cancelling"
                  />
                </div>
              )}

              {/* Executed → view tx on Arbiscan */}
              {req.status === 2 && lastTx && (
                <div className="flex items-center gap-2 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 text-[#10B981]" />
                  <span className="text-[#6B7280]">Transfer executed</span>
                  <TxLink hash={lastTx.hash} />
                </div>
              )}

              {/* Rejected — reason shown above, nothing actionable */}
              {req.status === 3 && (
                <p className="text-[10px] text-[#6B7280]">
                  This request was rejected. A new request may be submitted if appropriate.
                </p>
              )}

              {/* Cancelled */}
              {req.status === 4 && (
                <p className="text-[10px] text-[#6B7280]">This request was cancelled.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Treasury page ────────────────────────────────────────────────────────────

export function Treasury() {
  const { data: spendData, isLoading, error, refetch } = useSpend()
  const { data: health } = useHealth()

  const requests = spendData?.spendRequests ?? []

  const pending  = requests.filter(r => r.status === 0)
  const approved = requests.filter(r => r.status === 1)
  const executed = requests.filter(r => r.status === 2)
  const rejected = requests.filter(r => r.status === 3)

  const totalExecuted = executed.reduce((acc, r) => acc + BigInt(r.amount), 0n)
  const totalPending  = pending.reduce((acc, r) => acc + BigInt(r.amount), 0n)
  const totalApproved = approved.reduce((acc, r) => acc + BigInt(r.amount), 0n)

  return (
    <Page
      title="Treasury"
      description="Funding, spend requests, and lifecycle operations"
    >
      {/* Contract info bar */}
      <div className="border border-[#1F2937] bg-[#111827] px-4 py-2.5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[10px] text-[#6B7280]">
          <span>Contract</span>
          {health?.contract && (
            <>
              <span className="font-mono text-[#9CA3AF]">{health.contract}</span>
              <a
                href={`https://sepolia.arbiscan.io/address/${health.contract}`}
                target="_blank" rel="noreferrer"
                className="text-[#3B82F6] hover:text-[#60A5FA] flex items-center gap-0.5"
              >
                Arbiscan <ArrowUpRight className="w-2.5 h-2.5" />
              </a>
            </>
          )}
        </div>
        <span className="text-[10px] text-[#6B7280]">Arbitrum Sepolia · ETH only</span>
      </div>

      {/* ── Top operations row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <TreasuryBalanceCard />
        <DepositCard />
        <CreateRequestCard />
      </div>

      {/* ── Request pipeline stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1F2937] mb-6">
        <StatCard
          label="Total Released"
          value={formatWei(totalExecuted.toString())}
          sub={`${executed.length} executed`}
          accent
        />
        <StatCard
          label="Escrowed"
          value={formatWei(totalApproved.toString())}
          sub={`${approved.length} approved`}
        />
        <StatCard
          label="Pending Review"
          value={formatWei(totalPending.toString())}
          sub={`${pending.length} requests`}
        />
        <StatCard
          label="Rejected"
          value={rejected.length}
          sub={`of ${requests.length} total`}
        />
      </div>

      {/* Pipeline stage summary */}
      {requests.length > 0 && (
        <div className="grid grid-cols-4 gap-px bg-[#1F2937] mb-6">
          {[
            { label: 'Pending',  count: pending.length,  color: '#F59E0B', icon: <Clock        className="w-4 h-4" /> },
            { label: 'Approved', count: approved.length, color: '#3B82F6', icon: <CircleDot    className="w-4 h-4" /> },
            { label: 'Executed', count: executed.length, color: '#10B981', icon: <CheckCircle2 className="w-4 h-4" /> },
            { label: 'Rejected', count: rejected.length, color: '#EF4444', icon: <XCircle      className="w-4 h-4" /> },
          ].map(({ label, count, color, icon }) => (
            <div key={label} className="bg-[#111827] px-4 py-3 flex items-center gap-3">
              <div style={{ color }}>{icon}</div>
              <div>
                <p className="text-lg font-semibold text-[#F9FAFB]">{count}</p>
                <p className="text-[10px] text-[#6B7280]">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Requests table ─────────────────────────────────────────────────── */}
      <div className="border border-[#1F2937]">
        <div className="px-4 py-2.5 border-b border-[#1F2937] flex items-center justify-between">
          <h2 className="text-xs font-semibold text-[#F9FAFB] uppercase tracking-wider">
            Spend Requests
            <span className="text-[#6B7280] font-normal ml-1">({requests.length})</span>
          </h2>
          <p className="text-[10px] text-[#6B7280]">Click a row to view actions</p>
        </div>

        {error ? (
          <ErrorState message={(error as Error).message} retry={refetch} />
        ) : isLoading ? (
          <PageLoader />
        ) : requests.length === 0 ? (
          <EmptyState message="No spend requests. Agents with at least Bronze credential can create spend requests via the form above." />
        ) : (
          <table>
            <thead>
              <tr className="border-b border-[#1F2937]">
                {['Request', 'Agent', 'Amount', 'Purpose', 'Status', 'Date', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] text-[#6B7280] uppercase tracking-wider font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((req: SpendRequest, i) => (
                <SpendRow key={req.requestId} req={req} idx={i} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Credential limits reference ─────────────────────────────────────── */}
      <div className="mt-6 border border-[#1F2937] bg-[#111827] p-4">
        <p className="text-[10px] text-[#6B7280] uppercase tracking-wider mb-3">Credential Spend Limits</p>
        <div className="grid grid-cols-3 gap-px bg-[#1F2937]">
          {[
            { label: 'Bronze', limit: '0.1 ETH', pending: '1 concurrent', color: '#CD7F32', tasks: '3 tasks / 60 avg' },
            { label: 'Silver', limit: '1 ETH',   pending: '3 concurrent', color: '#9CA3AF', tasks: '10 tasks / 75 avg' },
            { label: 'Gold',   limit: '10 ETH',  pending: '5 concurrent', color: '#F59E0B', tasks: '25 tasks / 90 avg' },
          ].map(({ label, limit, pending, color, tasks }) => (
            <div key={label} className="bg-[#111827] px-4 py-3">
              <p className="text-xs font-semibold mb-1" style={{ color }}>{label}</p>
              <p className="text-sm font-semibold text-[#F9FAFB]">{limit} / request</p>
              <p className="text-[10px] text-[#6B7280]">{pending}</p>
              <p className="text-[10px] text-[#374151] mt-1">Unlocks at {tasks}</p>
            </div>
          ))}
        </div>
      </div>
    </Page>
  )
}
