import { type NextFunction, type Request, type Response } from "express";
import { permissionMap, type UserRole } from "@whatsapp/shared";

import { verifyAccessToken } from "../lib/jwt.js";
import { AppError } from "../lib/errors.js";

type Permission = (typeof permissionMap)[keyof typeof permissionMap][number];

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const token = bearer ?? req.cookies?.accessToken;

  if (!token) {
    return next(new AppError(401, "Authentication required"));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return next();
  } catch {
    return next(new AppError(401, "Invalid access token"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, "Insufficient role"));
    }

    return next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    const permissions = permissionMap[req.user.role] as readonly string[];
    if (!permissions.includes(permission)) {
      return next(new AppError(403, "Permission denied"));
    }

    return next();
  };
}
