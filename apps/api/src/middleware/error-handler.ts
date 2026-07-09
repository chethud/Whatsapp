import { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { logger } from "../config/logger.js";
import { AppError } from "../lib/errors.js";

function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError || (error as { name?: string })?.name === "ZodError";
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "Route not found"));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EBADCSRFTOKEN"
  ) {
    return res.status(403).json({
      success: false,
      error: "Invalid CSRF token",
    });
  }

  if (isZodError(error)) {
    return res.status(422).json({
      success: false,
      error: "Validation failed",
      details: error.flatten(),
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
      details: error.details,
    });
  }

  logger.error("Unhandled error", { error });
  return res.status(500).json({
    success: false,
    error: "Internal server error",
  });
}
