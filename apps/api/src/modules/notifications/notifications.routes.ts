import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/unread-count", async (req, res) => {
  const count = await prisma.notification.count({
    where: {
      readAt: null,
      OR: [{ userId: req.user?.id }, { userId: null }],
    },
  });

  res.json({ success: true, data: { count } });
});

notificationsRouter.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({
    where: {
      readAt: null,
      OR: [{ userId: req.user?.id }, { userId: null }],
    },
    data: { readAt: new Date() },
  });

  res.json({ success: true, data: null });
});

notificationsRouter.get("/", async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: {
      OR: [{ userId: req.user?.id }, { userId: null }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json({ success: true, data: notifications });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const notification = await prisma.notification.update({
    where: { id: req.params.id },
    data: { readAt: new Date() },
  });

  res.json({ success: true, data: notification });
});
