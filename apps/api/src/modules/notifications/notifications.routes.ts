import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

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
