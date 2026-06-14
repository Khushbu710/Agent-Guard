import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export interface ApiError {
  error: string;
  details?: unknown;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.flatten(),
    } satisfies ApiError);
    return;
  }

  if (err instanceof Error) {
    const status =
      err.message.includes("not found") ? 404 :
      err.message.includes("already") ? 409 :
      err.message.includes("No agent") ? 400 : 500;

    res.status(status).json({ error: err.message } satisfies ApiError);
    return;
  }

  res.status(500).json({ error: "Internal server error" } satisfies ApiError);
}
