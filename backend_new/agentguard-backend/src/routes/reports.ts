import { Router } from "express";
import { reportService } from "../services/ReportService.js";

export const reportsRouter = Router();

/**
 * GET /reports
 * List all generated reports, newest first.
 */
reportsRouter.get("/", (_req, res) => {
  const reports = reportService.getAllReports();
  res.json({ reports, count: reports.length });
});

/**
 * GET /reports/:id
 * Get a full report by ID.
 *
 * The report contains:
 *  - the original task
 *  - the AI agent's analysis and recommendation
 *  - the deterministic evaluation breakdown
 *  - the evidence package (evidenceHash + canonicalPayload for independent verification)
 *  - the onchain txHash and credentialId
 */
reportsRouter.get("/:id", (req, res, next) => {
  try {
    const report = reportService.getReport(req.params.id);
    if (!report) {
      res.status(404).json({ error: `Report not found: ${req.params.id}` });
      return;
    }
    res.json({ report });
  } catch (err) {
    next(err);
  }
});
