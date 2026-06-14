import { Router } from "express";
import { blockchainService } from "../services/BlockchainService.js";

export const spendRouter = Router();

/**
 * GET /spend
 * Read all spend requests from the AgentGuard contract via getSpendRequest().
 *
 * status is a RequestStatus enum value (0–4) returned as both integer and label:
 *   0=Pending  1=Approved  2=Executed  3=Rejected  4=Cancelled
 *
 * There is no `token` field — AgentGuard v1.0 operates exclusively in ETH.
 * There are no boolean `approved`/`executed` flags — lifecycle state is the
 * single `status` field.
 */
spendRouter.get("/", async (_req, res, next) => {
  try {
    const requests = await blockchainService.readAllSpendRequests();
    res.json({
      spendRequests: requests.map((r) => ({
        requestId: r.requestId,
        agent: r.agent,
        amount: r.amount.toString(),
        purpose: r.purpose,
        timestamp: r.timestamp,
        status: r.status,
        statusLabel: r.statusLabel,
        rejectionReason: r.rejectionReason || undefined,
      })),
      count: requests.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /spend/:id
 * Read a single spend request by ID.
 * Returns 404 if the contract reverts with RequestNotFound.
 */
spendRouter.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) {
      res.status(400).json({ error: "Spend request ID must be a non-negative integer" });
      return;
    }

    const request = await blockchainService.readSpendRequest(id);
    if (!request) {
      res.status(404).json({ error: `Spend request not found: ${id}` });
      return;
    }

    res.json({
      spendRequest: {
        requestId: request.requestId,
        agent: request.agent,
        amount: request.amount.toString(),
        purpose: request.purpose,
        timestamp: request.timestamp,
        status: request.status,
        statusLabel: request.statusLabel,
        rejectionReason: request.rejectionReason || undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});
