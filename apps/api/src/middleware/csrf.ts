import crypto from "crypto";
import { type NextFunction, type Request, type Response } from "express";

import { env } from "../config/env.js";

const TOKEN_TTL_MS = 60 * 60 * 1000;

function signPayload(payload: string) {
  return crypto.createHmac("sha256", env.CSRF_SECRET).update(payload).digest("base64url");
}

export function createCsrfToken() {
  const expiresAt = String(Date.now() + TOKEN_TTL_MS);
  return `${expiresAt}.${signPayload(expiresAt)}`;
}

function verifyCsrfToken(token: string) {
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) {
    return false;
  }

  const expires = Number(expiresAt);
  if (!Number.isFinite(expires) || Date.now() > expires) {
    return false;
  }

  const expected = signPayload(expiresAt);
  if (expected.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const token = req.headers["csrf-token"];
  if (typeof token !== "string" || !verifyCsrfToken(token)) {
    return res.status(403).json({
      success: false,
      error: "Invalid CSRF token",
    });
  }

  return next();
}
