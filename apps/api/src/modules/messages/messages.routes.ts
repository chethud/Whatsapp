import { Router } from "express";
import { paginationQuerySchema, sendMessageSchema } from "@whatsapp/shared";
import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { whatsappSessionRegistry } from "../../lib/whatsapp/session-registry.js";
import { AppError } from "../../lib/errors.js";

export const messagesRouter = Router();

messagesRouter.use(requireAuth, requirePermission("messages.manage"));

messagesRouter.get("/", validateQuery(paginationQuerySchema), async (req, res) => {
  const { page, pageSize, search } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
  };
  const chatId = String(req.query.chatId || "");

  const where = {
    ...(chatId ? { chatId } : {}),
    ...(search
      ? {
          content: { contains: search, mode: "insensitive" as const },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.message.count({ where }),
  ]);

  res.json({ success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
});

async function resolveChatExternalId(chatId: string) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) {
    throw new AppError(404, "Chat not found");
  }
  return chat;
}

messagesRouter.post("/", validateBody(sendMessageSchema), async (req, res, next) => {
  try {
    const chat = await resolveChatExternalId(req.body.chatId);

    if (req.body.scheduledAt) {
      const queued = await prisma.message.create({
        data: {
          sessionId: req.body.sessionId,
          chatId: req.body.chatId,
          direction: "OUTBOUND",
          type: req.body.type,
          content: req.body.content,
          mediaUrl: req.body.mediaUrl,
          mimeType: req.body.mimeType,
          fileName: req.body.fileName,
          latitude: req.body.latitude,
          longitude: req.body.longitude,
          sentAt: new Date(req.body.scheduledAt),
          scheduledAt: new Date(req.body.scheduledAt),
          status: "scheduled",
        },
      });

      const delay = Math.max(new Date(req.body.scheduledAt).getTime() - Date.now(), 0);
      setTimeout(async () => {
        try {
          await whatsappSessionRegistry.sendMessage({ ...req.body, chatId: chat.externalId });
          await prisma.message.update({
            where: { id: queued.id },
            data: { status: "sent" },
          });
        } catch {
          await prisma.message.update({
            where: { id: queued.id },
            data: { status: "failed" },
          });
        }
      }, delay);

      return res.status(202).json({ success: true, data: queued });
    }

    const message = await whatsappSessionRegistry.sendMessage({ ...req.body, chatId: chat.externalId });
    return res.status(201).json({ success: true, data: message });
  } catch (error) {
    return next(error);
  }
});

messagesRouter.post("/:id/star", async (req, res) => {
  const message = await prisma.message.update({
    where: { id: req.params.id },
    data: { starred: true },
  });
  res.json({ success: true, data: message });
});

messagesRouter.delete("/:id", async (req, res) => {
  const message = await prisma.message.update({
    where: { id: req.params.id },
    data: { deleted: true, status: "deleted" },
  });
  res.json({ success: true, data: message });
});
