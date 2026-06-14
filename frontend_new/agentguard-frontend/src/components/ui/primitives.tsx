import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import { cn } from './cn'

// ─── Badge ────────────────────────────────────────────────────────────────────

interface BadgeProps {
  children: React.ReactNode
  className?: string
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded-sm',
      className
    )}>
      {children}
    </span>
  )
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin', className)} />
}

// ─── Loading state ────────────────────────────────────────────────────────────

export function LoadingRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-[#1F2937]">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div
                className="h-4 bg-[#1F2937] rounded animate-pulse"
                style={{ width: `${60 + Math.random() * 30}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function LoadingCard() {
  return (
    <div className="border border-[#1F2937] bg-[#111827] p-4 space-y-3">
      <div className="h-4 bg-[#1F2937] rounded animate-pulse w-1/3" />
      <div className="h-8 bg-[#1F2937] rounded animate-pulse w-1/2" />
      <div className="h-3 bg-[#1F2937] rounded animate-pulse w-2/3" />
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner className="w-6 h-6 text-[#3B82F6]" />
    </div>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <AlertCircle className="w-8 h-8 text-[#EF4444]" />
      <p className="text-[#9CA3AF] text-sm max-w-xs">{message}</p>
      {retry && (
        <button
          onClick={retry}
          className="text-xs text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <Inbox className="w-8 h-8 text-[#374151]" />
      <p className="text-[#6B7280] text-sm">{message}</p>
      {action}
    </div>
  )
}
