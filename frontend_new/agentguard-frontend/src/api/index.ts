import type {
  TasksResponse, TaskResponse, ReportsResponse, ReportResponse,
  SpendResponse, SpendSingleResponse, HealthResponse,
  ExecuteResponse, AgentResponse, AgentSummaryResponse,
  CreateTaskInput,
  TreasuryBalanceResponse, DepositInput, DepositResponse,
  CreateSpendRequestInput, CreateSpendRequestResponse,
  TxReceiptResponse, ExecuteSpendResponse,
} from '../types'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Health ───────────────────────────────────────────────────────────────────

export const api = {
  health: () => request<HealthResponse>('/health'),

  // ─── Tasks ──────────────────────────────────────────────────────────────────

  tasks: {
    list: () => request<TasksResponse>('/tasks'),
    get: (id: string) => request<TaskResponse>(`/tasks/${id}`),
    create: (input: CreateTaskInput) =>
      request<TaskResponse>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    execute: (id: string, agentAddress?: string) =>
      request<ExecuteResponse>(`/tasks/${id}/execute`, {
        method: 'POST',
        body: JSON.stringify(agentAddress ? { agentAddress } : {}),
      }),
  },

  // ─── Agents ─────────────────────────────────────────────────────────────────

  agents: {
    get: (address: string) => request<AgentResponse>(`/agents/${address}`),
    summary: (address: string) => request<AgentSummaryResponse>(`/agents/${address}/summary`),
  },

  // ─── Reports ────────────────────────────────────────────────────────────────

  reports: {
    list: () => request<ReportsResponse>('/reports'),
    get: (id: string) => request<ReportResponse>(`/reports/${id}`),
  },

  // ─── Spend ──────────────────────────────────────────────────────────────────

  spend: {
    list: () => request<SpendResponse>('/spend'),
    get: (id: number) => request<SpendSingleResponse>(`/spend/${id}`),
  },

  // ─── Treasury operations ─────────────────────────────────────────────────────

  treasury: {
    balance: () => request<TreasuryBalanceResponse>('/treasury/balance'),
    deposit: (input: DepositInput) =>
      request<DepositResponse>('/treasury/deposit', { method: 'POST', body: JSON.stringify(input) }),
    createRequest: (input: CreateSpendRequestInput) =>
      request<CreateSpendRequestResponse>('/treasury/requests', { method: 'POST', body: JSON.stringify(input) }),
    approve: (id: number) =>
      request<TxReceiptResponse>(`/treasury/requests/${id}/approve`, { method: 'POST', body: '{}' }),
    reject: (id: number, reason: string) =>
      request<TxReceiptResponse>(`/treasury/requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    cancel: (id: number) =>
      request<TxReceiptResponse>(`/treasury/requests/${id}/cancel`, { method: 'POST', body: '{}' }),
    execute: (id: number, agentAddress: string) =>
      request<ExecuteSpendResponse>(`/treasury/requests/${id}/execute`, { method: 'POST', body: JSON.stringify({ agentAddress }) }),
  },
}
