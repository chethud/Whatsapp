import { Router } from "express";
import QRCode from "qrcode";
import { createWhatsappSessionSchema, paginationQuerySchema } from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { whatsappSessionRegistry } from "../../lib/whatsapp/session-registry.js";
import { AppError } from "../../lib/errors.js";

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth, requirePermission("sessions.manage"));

sessionsRouter.get("/", validateQuery(paginationQuerySchema), async (req, res) => {
  const { page, pageSize, search } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
  };

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phoneNumber: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.whatsappSession.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.whatsappSession.count({ where }),
  ]);

  for (const session of items) {
    void whatsappSessionRegistry.restoreSessionIfNeeded(session.id);
  }

  res.json({
    success: true,
    data: {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

sessionsRouter.get("/:id", async (req, res, next) => {
  try {
    await whatsappSessionRegistry.restoreSessionIfNeeded(req.params.id);
    const session = await whatsappSessionRegistry.getSession(req.params.id);
    const qrDataUrl = session.qrCode
      ? await QRCode.toDataURL(session.qrCode, { margin: 1, width: 280, errorCorrectionLevel: "M" })
      : null;
    res.json({ success: true, data: { ...session, qrDataUrl } });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/", validateBody(createWhatsappSessionSchema), async (req, res, next) => {
  try {
    const session = await whatsappSessionRegistry.createSession(
      req.body.name,
      req.user?.id,
      req.body.autoReconnect,
    );
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:id/connect", async (req, res, next) => {
  try {
    await whatsappSessionRegistry.startSession(req.params.id);
    const session = await prisma.whatsappSession.findUnique({ where: { id: req.params.id } });
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:id/disconnect", async (req, res, next) => {
  try {
    await whatsappSessionRegistry.disconnectSession(req.params.id);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:id/logout", async (req, res, next) => {
  try {
    await whatsappSessionRegistry.logoutSession(req.params.id);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:id/reconnect", async (req, res, next) => {
  try {
    await whatsappSessionRegistry.reconnectSession(req.params.id);
    const session = await prisma.whatsappSession.findUnique({ where: { id: req.params.id } });
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.delete("/:id", async (req, res, next) => {
  try {
    await whatsappSessionRegistry.deleteSession(req.params.id);
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
});
