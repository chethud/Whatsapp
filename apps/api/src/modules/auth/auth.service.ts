import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { sha256 } from "../../lib/crypto.js";
import { type UserRole } from "@whatsapp/shared";

async function writeAuditLog(userId: string | null, action: string, metadata?: unknown) {
  await prisma.auditLog.create({
    data: {
      userId: userId ?? undefined,
      action,
      entityType: "auth",
      metadata: metadata as object | undefined,
    },
  });
}

export const authService = {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError(401, "Invalid email or password");
    }

    if (!user.isActive) {
      throw new AppError(403, "User is inactive");
    }

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
    });
    const refreshToken = signRefreshToken({ sub: user.id, email: user.email });

    await prisma.refreshToken.create({
      data: {
        tokenHash: sha256(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await writeAuditLog(user.id, "auth.login");

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  },

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, "Refresh token is invalid or expired");
    }

    const nextAccessToken = signAccessToken({
      sub: stored.user.id,
      email: stored.user.email,
      role: stored.user.role as UserRole,
    });
    const nextRefreshToken = signRefreshToken({ sub: payload.sub, email: payload.email });

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          tokenHash: sha256(nextRefreshToken),
          userId: stored.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    await writeAuditLog(stored.user.id, "auth.refresh");

    return {
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      user: {
        id: stored.user.id,
        name: stored.user.name,
        email: stored.user.email,
        role: stored.user.role,
      },
    };
  },

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return;
    }

    const tokenHash = sha256(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async bootstrapAdmin(input: { name: string; email: string; password: string; role: UserRole }) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(409, "User already exists");
    }

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: input.role,
      },
    });

    await writeAuditLog(user.id, "auth.bootstrap");
    return user;
  },
};
