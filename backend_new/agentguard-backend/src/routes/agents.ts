import { Router } from "express";
import { ethers } from "ethers";
import { blockchainService } from "../services/BlockchainService.js";
import { store } from "../utils/store.js";

export const agentsRouter = Router();

/**
 * GET /agents/:address
 * Read an agent's profile from the AgentGuard contract via getAgent().
 * Also returns backend-tracked task history for this agent.
 *
 * credentialLevel is sourced entirely from the contract — it is derived
 * automatically by the contract from completedTasks and rolling averageScore.
 * The backend never computes or assigns a level.
 */
agentsRouter.get("/:address", async (req, res, next) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      res.status(400).json({ error: `Invalid Ethereum address: ${address}` });
      return;
    }

    const [onchain, tasks] = await Promise.all([
      blockchainService.readAgent(address),
      Promise.resolve(
        store.getAllTasks().filter(
          (t) => t.agentAddress?.toLowerCase() === address.toLowerCase()
        )
      ),
    ]);

    if (!onchain) {
      res.status(404).json({ error: `Agent not registered on contract: ${address}` });
      return;
    }

    res.json({
      agent: {
        address: ethers.getAddress(address),
        onchain: {
          owner: onchain.owner,
          name: onchain.name,
          completedTasks: onchain.completedTasks,
          averageScore: onchain.averageScore,
          credentialLevel: onchain.credentialLevel,
          credentialLevelLabel: onchain.credentialLevelLabel,
          totalReleasedWei: onchain.totalReleasedWei.toString(),
          pendingCount: onchain.pendingCount,
        },
        backendTaskHistory: tasks,
        backendTaskCount: tasks.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /agents/:address/summary
 * Full dashboard summary from getAgentSummary() — includes spend limits
 * and available treasury in one call. Useful for frontend permission views.
 */
agentsRouter.get("/:address/summary", async (req, res, next) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      res.status(400).json({ error: `Invalid Ethereum address: ${address}` });
      return;
    }

    const summary = await blockchainService.readAgentSummary(address);
    if (!summary) {
      res.status(404).json({ error: `Agent not registered on contract: ${address}` });
      return;
    }

    res.json({
      summary: {
        address: ethers.getAddress(address),
        owner: summary.owner,
        name: summary.name,
        completedTasks: summary.completedTasks,
        averageScore: summary.averageScore,
        credentialLevel: summary.credentialLevel,
        credentialLevelLabel: summary.credentialLevelLabel,
        totalReleasedWei: summary.totalReleasedWei.toString(),
        pendingCount: summary.pendingCount,
        spendLimit: summary.spendLimit.toString(),
        pendingLimit: summary.pendingLimit,
        availableTreasury: summary.availableTreasury.toString(),
      },
    });
  } catch (err) {
    next(err);
  }
});
