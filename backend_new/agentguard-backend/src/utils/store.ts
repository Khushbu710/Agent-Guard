import type { Task, Report } from "../models/index.js";

/**
 * InMemoryStore
 *
 * The backend is the source of truth for task lifecycle and reports.
 * The contract is the source of truth for credentials and permissions.
 *
 * For production, swap this with a PostgreSQL or Redis-backed store
 * while keeping the same interface. All services depend on this
 * interface, not the in-memory implementation.
 */
class InMemoryStore {
  private tasks = new Map<string, Task>();
  private reports = new Map<string, Report>();

  // ─── Tasks ──────────────────────────────────────────────────────────────────

  saveTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  updateTask(id: string, updates: Partial<Task>): Task | undefined {
    const existing = this.tasks.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.tasks.set(id, updated);
    return updated;
  }

  // ─── Reports ────────────────────────────────────────────────────────────────

  saveReport(report: Report): void {
    this.reports.set(report.id, report);
  }

  getReport(id: string): Report | undefined {
    return this.reports.get(id);
  }

  getReportByTaskId(taskId: string): Report | undefined {
    for (const report of this.reports.values()) {
      if (report.taskId === taskId) return report;
    }
    return undefined;
  }

  getAllReports(): Report[] {
    return Array.from(this.reports.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  updateReport(id: string, updates: Partial<Report>): Report | undefined {
    const existing = this.reports.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.reports.set(id, updated);
    return updated;
  }
}

// Singleton — all services share one store
export const store = new InMemoryStore();
