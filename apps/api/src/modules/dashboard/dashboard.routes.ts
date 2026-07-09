import { Router } from "express";
import { SessionStatus, MessageDirection } from "@prisma/client";

import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/stats", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    connectedAccounts,
    disconnectedAccounts,
    sentMessages,
    receivedMessages,
    aiReplies,
    contacts,
    unreadChats,
    queueSize,
    activeSessions,
  ] = await Promise.all([
    prisma.whatsappSession.count({ where: { status: SessionStatus.CONNECTED } }),
    prisma.whatsappSession.count({ where: { status: { not: SessionStatus.CONNECTED } } }),
    prisma.message.count({ where: { direction: MessageDirection.OUTBOUND, createdAt: { gte: today } } }),
    prisma.message.count({ where: { direction: MessageDirection.INBOUND, createdAt: { gte: today } } }),
    prisma.aiMessage.count({ where: { role: "assistant", createdAt: { gte: today } } }),
    prisma.contact.count(),
    prisma.chat.aggregate({ _sum: { unreadCount: true } }),
    prisma.message.count({ where: { status: "scheduled" } }),
    prisma.whatsappSession.count(),
  ]);

  res.json({
    success: true,
    data: {
      connectedAccounts,
      disconnectedAccounts,
      todaysMessages: sentMessages + receivedMessages,
      sentMessages,
      receivedMessages,
      aiReplies,
      groupsManaged: 0,
      activeCampaigns: 0,
      contacts,
      unreadMessages: unreadChats._sum.unreadCount ?? 0,
      queueSize,
      serverStatus: "healthy",
      activeSessions,
    },
  });
});
