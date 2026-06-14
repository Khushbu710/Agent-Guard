import { ethers } from 'ethers'
import { CREDENTIAL_LABEL, REQUEST_STATUS_LABEL } from '../types'

export function truncateAddress(addr: string, chars = 6): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, chars)}…${addr.slice(-4)}`
}

export function formatWei(wei: string | bigint, decimals = 4): string {
  try {
    const val = ethers.formatEther(wei)
    const num = parseFloat(val)
    if (num === 0) return '0 ETH'
    if (num < 0.0001) return '< 0.0001 ETH'
    return `${num.toFixed(decimals)} ETH`
  } catch {
    return '— ETH'
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatDateTime(iso: string | number): string {
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function formatTimestamp(ts: number): string {
  return formatDateTime(ts)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function credentialLabel(level: number): string {
  return CREDENTIAL_LABEL[level] ?? 'Unknown'
}

export function requestStatusLabel(status: number): string {
  return REQUEST_STATUS_LABEL[status] ?? 'Unknown'
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'text-[#10B981]'
  if (score >= 60) return 'text-[#F59E0B]'
  return 'text-[#EF4444]'
}

export function credentialColor(level: number): string {
  if (level === 3) return 'text-[#F59E0B]'
  if (level === 2) return 'text-[#9CA3AF]'
  if (level === 1) return 'text-[#CD7F32]'
  return 'text-[#6B7280]'
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completed': return 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'
    case 'running':   return 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20'
    case 'failed':    return 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20'
    default:          return 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/20'
  }
}

export function spendStatusBadgeClass(status: number): string {
  switch (status) {
    case 1: return 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20'  // Approved
    case 2: return 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'  // Executed
    case 3: return 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20'  // Rejected
    case 4: return 'bg-[#6B7280]/10 text-[#6B7280] border-[#6B7280]/20'  // Cancelled
    default: return 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20' // Pending
  }
}

export function shortenHash(hash: string, chars = 8): string {
  if (!hash || hash.length < 12) return hash
  return `${hash.slice(0, chars + 2)}…${hash.slice(-6)}`
}

export function arbiscanTx(hash: string): string {
  return `https://sepolia.arbiscan.io/tx/${hash}`
}
