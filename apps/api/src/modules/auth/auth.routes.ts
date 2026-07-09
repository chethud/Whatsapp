import { type Response, Router } from "express";
import { createUserSchema, loginSchema, refreshSchema } from "@whatsapp/shared";

import { authService } from "./auth.service.js";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { env, isProduction } from "../../config/env.js";
import { getCookieSameSite } from "../../config/cors.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";

export const authRouter = Router();

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: getCookieSameSite(),
    domain: env.COOKIE_DOMAIN,
  };

  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

authRouter.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body.email, req.body.password);
    setAuthCookies(res, result.accessToken, result.refreshToken);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", validateBody(refreshSchema), async (req, res, next) => {
  try {
    const token = req.body.refreshToken ?? req.cookies?.refreshToken;
    const result = await authService.refresh(token);
    setAuthCookies(res, result.accessToken, result.refreshToken);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    await authService.logout(req.cookies?.refreshToken ?? req.body?.refreshToken);
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.json({ success: true, data: null, message: "Logged out" });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      twoFactorEnabled: true,
      createdAt: true,
    },
  });
  res.json({ success: true, data: user });
});

authRouter.patch("/password", requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword ?? "");
    const nextPassword = String(req.body.nextPassword ?? "");
    if (nextPassword.length < 8) {
      throw new AppError(422, "New password must be at least 8 characters");
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError(401, "Current password is incorrect");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(nextPassword) },
    });

    res.json({ success: true, data: null, message: "Password updated" });
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  "/bootstrap-admin",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  validateBody(createUserSchema),
  async (req, res, next) => {
    try {
      const user = await authService.bootstrapAdmin(req.body);
      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  },
);
