import "dotenv/config";
import express from "express";
import morgan from "morgan";
import cors from "cors";

import { config } from "./config/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { tasksRouter } from "./routes/tasks.js";
import { agentsRouter } from "./routes/agents.js";
import { reportsRouter } from "./routes/reports.js";
import { spendRouter } from "./routes/spend.js";
import { treasuryRouter } from "./routes/treasury.js";
import { blockchainService } from "./services/BlockchainService.js";

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  const blockchain = await blockchainService.healthCheck();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    blockchain,
    contract: config.blockchain.contractAddress,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/tasks", tasksRouter);
app.use("/agents", agentsRouter);
app.use("/reports", reportsRouter);
app.use("/spend", spendRouter);
app.use("/treasury", treasuryRouter);

// ─── Error handler (must be last) ─────────────────────────────────────────────

app.use(errorHandler);

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  console.log("\n══════════════════════════════════════════");
  console.log("  AgentGuard Backend");
  console.log("══════════════════════════════════════════");
  console.log(`  Contract: ${config.blockchain.contractAddress}`);
  console.log(`  Network:  ${config.blockchain.rpcUrl}`);
  console.log(`  LLM:      ${config.llm.baseUrl} (${config.llm.model})`);

  const health = await blockchainService.healthCheck();
  if (health.connected) {
    console.log(`  Chain:    ${health.chainId} — block ${health.blockNumber} ✓`);
  } else {
    console.warn("  Chain:    ⚠ Could not connect to RPC. Blockchain calls will fail.");
  }

  app.listen(config.port, () => {
    console.log(`\n  Listening on http://localhost:${config.port}`);
    console.log("══════════════════════════════════════════\n");
  });
}

boot().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
