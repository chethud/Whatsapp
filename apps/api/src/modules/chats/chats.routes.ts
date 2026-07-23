import { Router } from "express";
import { paginationQuerySchema } from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateQuery } from "../../middleware/validate.js";
import { whatsappSessionRegistry } from "../../lib/whatsapp/session-registry.js";

export const chatsRouter = Router();

chatsRouter.use(requireAuth, requirePermission("messages.manage"));

chatsRouter.get("/", validateQuery(paginationQuerySchema), async (req, res) => {
  const { page, pageSize, search } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
  };
  const sessionId = String(req.query.sessionId || "");

  const where = {
    ...(sessionId ? { sessionId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { externalId: { contains: search, mode: "insensitive" as const } },
            { contact: { is: { phoneNumber: { contains: search, mode: "insensitive" as const } } } },
            { contact: { is: { name: { contains: search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.chat.findMany({
      where,
      include: { contact: true },
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.chat.count({ where }),
  ]);

  res.json({ success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
});

chatsRouter.post("/sync/:sessionId", async (req, res, next) => {
  try {
    const data = await whatsappSessionRegistry.syncChats(req.params.sessionId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

chatsRouter.post("/:id/pin", async (req, res) => {
  const chat = await prisma.chat.update({
    where: { id: req.params.id },
    data: { pinned: true },
  });
  res.json({ success: true, data: chat });
});

chatsRouter.post("/:id/mark-read", async (req, res, next) => {
  try {
    const chat = await prisma.chat.update({
      where: { id: req.params.id },
      data: { unreadCount: 0 },
    });
    res.json({ success: true, data: chat });
  } catch (error) {
    next(error);
  }
});
