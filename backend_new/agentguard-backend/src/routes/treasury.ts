import { Router } from "express";
import { z } from "zod";
import { ethers } from "ethers";
import { blockchainService } from "../services/BlockchainService.js";

export const treasuryRouter = Router();

// ─── Input schemas ────────────────────────────────────────────────────────────

const DepositSchema = z.object({
  amountEth: z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal ETH amount"),
});

const CreateSpendRequestSchema = z.object({
  agentAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address"),
  amountEth: z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal ETH amount"),
  purpose: z.string().min(1, "Purpose is required").max(500),
});

const RejectSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
});

const ExecuteSchema = z.object({
  agentAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address"),
});

// ─── Treasury balance ─────────────────────────────────────────────────────────

/**
 * GET /treasury/balance
 * Returns the contract's ETH balances:
 *   - totalBalanceWei: address(this).balance
 *   - availableWei:    balance - _escrowedAmount
 *   - escrowedWei:     _escrowedAmount (approved but unexecuted)
 */
treasuryRouter.get("/balance", async (_req, res, next) => {
  try {
    const balance = await blockchainService.readTreasuryBalance();
    res.json({ balance });
  } catch (err) {
    next(err);
  }
});

// ─── Deposit ──────────────────────────────────────────────────────────────────

/**
 * POST /treasury/deposit
 * Calls depositTreasury() as the contract owner (backend signer).
 * Body: { amountEth: "0.5" }
 *
 * The backend signer must be the contract owner and must hold sufficient ETH.
 * Amount is specified in ETH (human-readable); converted to wei before the call.
 */
treasuryRouter.post("/deposit", async (req, res, next) => {
  try {
    const { amountEth } = DepositSchema.parse(req.body);
    const amountWei = ethers.parseEther(amountEth).toString();
    const result = await blockchainService.depositTreasury(amountWei);
    res.json({
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      depositedEth: amountEth,
      newBalanceWei: result.newBalance,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Create spend request ─────────────────────────────────────────────────────

/**
 * POST /treasury/requests
 * Calls createSpendRequest(agentAddress, amount, purpose).
 * Body: { agentAddress: "0x…", amountEth: "0.05", purpose: "…" }
 *
 * The backend signer must be the owner of the agent's profile on the contract.
 * Amount is validated against the agent's credential spend limit on-chain.
 */
treasuryRouter.post("/requests", async (req, res, next) => {
  try {
    const { agentAddress, amountEth, purpose } = CreateSpendRequestSchema.parse(req.body);
    const amountWei = ethers.parseEther(amountEth).toString();
    const result = await blockchainService.createSpendRequest(agentAddress, amountWei, purpose);
    res.status(201).json({
      requestId: result.requestId,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Approve ──────────────────────────────────────────────────────────────────

/**
 * POST /treasury/requests/:id/approve
 * Calls approveSpendRequest(requestId) as the contract owner.
 * Checks available treasury on-chain; reverts if insufficient funds.
 * The approved amount is added to _escrowedAmount by the contract.
 */
treasuryRouter.post("/requests/:id/approve", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) {
      res.status(400).json({ error: "Request ID must be a non-negative integer" });
      return;
    }
    const result = await blockchainService.approveSpendRequest(id);
    res.json({ txHash: result.txHash, blockNumber: result.blockNumber });
  } catch (err) {
    next(err);
  }
});

// ─── Reject ───────────────────────────────────────────────────────────────────

/**
 * POST /treasury/requests/:id/reject
 * Calls rejectSpendRequest(requestId, reason) as the contract owner.
 * Body: { reason: "…" }
 * Reason is stored on-chain in the SpendRequest struct.
 */
treasuryRouter.post("/requests/:id/reject", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) {
      res.status(400).json({ error: "Request ID must be a non-negative integer" });
      return;
    }
    const { reason } = RejectSchema.parse(req.body);
    const result = await blockchainService.rejectSpendRequest(id, reason);
    res.json({ txHash: result.txHash, blockNumber: result.blockNumber });
  } catch (err) {
    next(err);
  }
});

// ─── Cancel ───────────────────────────────────────────────────────────────────

/**
 * POST /treasury/requests/:id/cancel
 * Calls cancelSpendRequest(requestId).
 * Pending requests: cancellable by agent owner or protocol owner.
 * Approved requests: cancellable by protocol owner only (releases escrow).
 * The backend signer must hold the appropriate owner role for the request state.
 */
treasuryRouter.post("/requests/:id/cancel", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) {
      res.status(400).json({ error: "Request ID must be a non-negative integer" });
      return;
    }
    const result = await blockchainService.cancelSpendRequest(id);
    res.json({ txHash: result.txHash, blockNumber: result.blockNumber });
  } catch (err) {
    next(err);
  }
});

// ─── Execute ──────────────────────────────────────────────────────────────────

/**
 * POST /treasury/requests/:id/execute
 * Calls executeSpendRequest(agentAddress, requestId).
 * Body: { agentAddress: "0x…" }
 *
 * The backend signer must be the agent owner. Transfers escrowed ETH to the agent.
 * The contract uses checks-effects-interactions; re-entrancy guard is active.
 */
treasuryRouter.post("/requests/:id/execute", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0) {
      res.status(400).json({ error: "Request ID must be a non-negative integer" });
      return;
    }
    const { agentAddress } = ExecuteSchema.parse(req.body);
    const result = await blockchainService.executeSpendRequest(agentAddress, id);
    res.json({
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      executedAmountWei: result.amountWei,
    });
  } catch (err) {
    next(err);
  }
});
