import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, ClipboardList, FileText, Landmark, Activity, Wallet, AlertTriangle } from 'lucide-react'
import { useHealth } from '../../hooks'
import { useWallet } from '../../hooks/useWallet'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/agents', label: 'Agents', icon: Users },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/treasury', label: 'Treasury', icon: Landmark },
]


function WalletButton() {
  const { address, isCorrectChain, isConnecting, error, connect } = useWallet()

  if (address) {
    return (
      <div className="flex items-center gap-2">
        {!isCorrectChain && (
          <div className="flex items-center gap-1 text-[10px] text-[#F59E0B]">
            <AlertTriangle className="w-3 h-3" />
            Wrong network
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-1 border border-[#1F2937] bg-[#111827]">
          <div className={`w-1.5 h-1.5 rounded-full ${isCorrectChain ? 'bg-[#10B981]' : 'bg-[#F59E0B]'}`} />
          <span className="text-[10px] font-mono text-[#9CA3AF]">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={connect}
      disabled={isConnecting}
      className="flex items-center gap-1.5 px-2.5 py-1 border border-[#1F2937] hover:border-[#3B82F6] bg-[#111827] text-[10px] text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors disabled:opacity-50"
    >
      <Wallet className="w-3 h-3" />
      {isConnecting ? 'Connecting…' : 'Connect Wallet'}
      {error && <span className="text-[#EF4444] ml-1">!</span>}
    </button>
  )
}

export function AppLayout() {
  const { data: health } = useHealth()

  return (
    <div className="flex h-screen bg-[#0B0F1A] overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-52 flex-shrink-0 border-r border-[#1F2937] flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-[#1F2937]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#3B82F6] flex items-center justify-center">
              <span className="text-xs font-bold text-white">AG</span>
            </div>
            <span className="font-semibold text-[#F9FAFB] text-sm">AgentGuard</span>
          </div>
          <p className="text-[10px] text-[#6B7280] mt-1">Protocol v1.0 · Arbitrum Sepolia</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm transition-colors ${
                  isActive
                    ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#1A2235]'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Network status */}
        <div className="border-t border-[#1F2937] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${health?.blockchain.connected ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
            <span className="text-[10px] text-[#6B7280]">
              {health?.blockchain.connected
                ? `Block ${health.blockchain.blockNumber?.toLocaleString()}`
                : 'Disconnected'}
            </span>
          </div>
          {health?.contract && (
            <p className="text-[10px] text-[#6B7280] mt-0.5 font-mono truncate">
              {health.contract.slice(0, 10)}…
            </p>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-10 border-b border-[#1F2937] flex items-center px-6 flex-shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-[#6B7280]" />
            <span className="text-xs text-[#6B7280]">Trust Framework — Treasury Operations</span>
          </div>
          <WalletButton />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
