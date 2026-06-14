import { store } from "../utils/store.js";
import type { Report } from "../models/index.js";

export class ReportService {
  getReport(id: string): Report | undefined {
    return store.getReport(id);
  }

  getReportByTaskId(taskId: string): Report | undefined {
    return store.getReportByTaskId(taskId);
  }

  getAllReports(): Report[] {
    return store.getAllReports();
  }
}

export const reportService = new ReportService();
