interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
  mono?: boolean
}

export function StatCard({ label, value, sub, accent, mono }: StatCardProps) {
  return (
    <div className="border border-[#1F2937] bg-[#111827] p-4">
      <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accent ? 'text-[#3B82F6]' : 'text-[#F9FAFB]'} ${mono ? 'font-mono text-lg' : ''}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-[#6B7280] mt-1">{sub}</p>}
    </div>
  )
}
