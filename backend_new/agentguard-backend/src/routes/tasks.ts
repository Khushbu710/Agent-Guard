import { Router } from "express";
import { taskService } from "../services/TaskService.js";
import { CreateTaskSchema, ExecuteTaskSchema } from "../models/index.js";

export const tasksRouter = Router();

/**
 * POST /tasks
 * Create a new task (does not execute it).
 *
 * Body: { title, description, taskType, agentAddress }
 */
tasksRouter.post("/", (req, res, next) => {
  try {
    const input = CreateTaskSchema.parse(req.body);
    const task = taskService.createTask(input);
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tasks
 * List all tasks, newest first.
 */
tasksRouter.get("/", (_req, res) => {
  const tasks = taskService.getTasks();
  res.json({ tasks, count: tasks.length });
});

/**
 * GET /tasks/:id
 * Get a single task by ID.
 */
tasksRouter.get("/:id", (req, res, next) => {
  try {
    const task = taskService.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: `Task not found: ${req.params.id}` });
      return;
    }
    res.json({ task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks/:id/execute
 * Trigger the full pipeline: LLM → evaluate → evidence → onchain credential.
 *
 * Body (optional): { agentAddress }
 *   If agentAddress is omitted, uses the address set when the task was created.
 *
 * Returns the completed Report.
 * This is an async operation that runs to completion before responding.
 * For long tasks, consider wrapping in a job queue.
 */
tasksRouter.post("/:id/execute", async (req, res, next) => {
  try {
    const { agentAddress } = ExecuteTaskSchema.parse(req.body ?? {});
    const report = await taskService.executeTask(req.params.id, agentAddress);
    res.status(200).json({ report });
  } catch (err) {
    next(err);
  }
});
