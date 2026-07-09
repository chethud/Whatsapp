import jwt from "jsonwebtoken";
import { type UserRole } from "@whatsapp/shared";

import { env } from "../config/env.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

export function signRefreshToken(payload: Pick<AccessTokenPayload, "sub" | "email">) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as Pick<AccessTokenPayload, "sub" | "email">;
}
