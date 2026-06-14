import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { CreateTaskInput } from '../types'

// ─── Query keys ───────────────────────────────────────────────────────────────

export const QK = {
  health: ['health'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  agent: (address: string) => ['agents', address] as const,
  agentSummary: (address: string) => ['agents', address, 'summary'] as const,
  reports: ['reports'] as const,
  report: (id: string) => ['reports', id] as const,
  spend: ['spend'] as const,
  treasuryBalance: ['treasury', 'balance'] as const,
}

// ─── Health ───────────────────────────────────────────────────────────────────

export function useHealth() {
  return useQuery({ queryKey: QK.health, queryFn: api.health, refetchInterval: 30_000 })
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export function useTasks() {
  return useQuery({ queryKey: QK.tasks, queryFn: api.tasks.list, refetchInterval: 10_000 })
}

export function useTask(id: string) {
  return useQuery({
    queryKey: QK.task(id),
    queryFn: () => api.tasks.get(id),
    enabled: !!id,
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.tasks.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.tasks }),
  })
}

export function useExecuteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, agentAddress }: { id: string; agentAddress?: string }) =>
      api.tasks.execute(id, agentAddress),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: QK.tasks })
      qc.invalidateQueries({ queryKey: QK.task(id) })
      qc.invalidateQueries({ queryKey: QK.reports })
    },
  })
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export function useAgent(address: string) {
  return useQuery({
    queryKey: QK.agent(address),
    queryFn: () => api.agents.get(address),
    enabled: !!address && address.startsWith('0x'),
  })
}

export function useAgentSummary(address: string) {
  return useQuery({
    queryKey: QK.agentSummary(address),
    queryFn: () => api.agents.summary(address),
    enabled: !!address && address.startsWith('0x'),
  })
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export function useReports() {
  return useQuery({ queryKey: QK.reports, queryFn: api.reports.list, refetchInterval: 15_000 })
}

export function useReport(id: string) {
  return useQuery({
    queryKey: QK.report(id),
    queryFn: () => api.reports.get(id),
    enabled: !!id,
  })
}

// ─── Spend ───────────────────────────────────────────────────────────────────

export function useSpend() {
  return useQuery({ queryKey: QK.spend, queryFn: api.spend.list, refetchInterval: 15_000 })
}

// ─── Treasury ─────────────────────────────────────────────────────────────────

export function useTreasuryBalance() {
  return useQuery({
    queryKey: QK.treasuryBalance,
    queryFn: api.treasury.balance,
    refetchInterval: 20_000,
  })
}

function invalidateTreasury(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: QK.spend })
  qc.invalidateQueries({ queryKey: QK.treasuryBalance })
}

export function useDepositTreasury() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (amountEth: string) => api.treasury.deposit({ amountEth }),
    onSuccess: () => invalidateTreasury(qc),
  })
}

export function useApproveRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.treasury.approve(id),
    onSuccess: () => invalidateTreasury(qc),
  })
}

export function useRejectRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.treasury.reject(id, reason),
    onSuccess: () => invalidateTreasury(qc),
  })
}

export function useCancelRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.treasury.cancel(id),
    onSuccess: () => invalidateTreasury(qc),
  })
}

export function useExecuteRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, agentAddress }: { id: number; agentAddress: string }) =>
      api.treasury.execute(id, agentAddress),
    onSuccess: () => invalidateTreasury(qc),
  })
}
