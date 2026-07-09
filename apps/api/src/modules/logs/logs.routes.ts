import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";

export const logsRouter = Router();

logsRouter.use(requireAuth, requirePermission("logs.read"));

logsRouter.get("/audit", async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ success: true, data: logs });
});
