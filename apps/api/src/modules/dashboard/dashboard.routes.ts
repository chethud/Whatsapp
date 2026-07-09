import { Router } from "express";
import { SessionStatus, MessageDirection } from "@prisma/client";

import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const dashboardRouter = Router();

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

dashboardRouter.get("/analytics", async (_req, res) => {
  const days = 7;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const [messages, sessionsByStatus, topChatCounts] = await Promise.all([
    prisma.message.findMany({
      where: { sentAt: { gte: start } },
      select: { sentAt: true, direction: true },
    }),
    prisma.whatsappSession.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["chatId"],
      where: { sentAt: { gte: start } },
      _count: { _all: true },
      orderBy: { _count: { chatId: "desc" } },
      take: 5,
    }),
  ]);

  const messageTrend = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      inbound: 0,
      outbound: 0,
      total: 0,
    };
  });

  const trendByDate = new Map(messageTrend.map((day) => [day.date, day]));
  for (const message of messages) {
    const key = message.sentAt.toISOString().slice(0, 10);
    const bucket = trendByDate.get(key);
    if (!bucket) {
      continue;
    }
    if (message.direction === MessageDirection.INBOUND) {
      bucket.inbound += 1;
    } else {
      bucket.outbound += 1;
    }
    bucket.total += 1;
  }

  const chatIds = topChatCounts.map((row) => row.chatId);
  const chats = chatIds.length
    ? await prisma.chat.findMany({
        where: { id: { in: chatIds } },
        select: { id: true, name: true, externalId: true },
      })
    : [];
  const chatNameById = new Map(chats.map((chat) => [chat.id, chat.name ?? chat.externalId]));

  res.json({
    success: true,
    data: {
      messageTrend,
      sessionsByStatus: sessionsByStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      topChats: topChatCounts.map((row) => ({
        chatId: row.chatId,
        name: chatNameById.get(row.chatId) ?? row.chatId,
        messages: row._count._all,
      })),
      totals: {
        inbound: messages.filter((message) => message.direction === MessageDirection.INBOUND).length,
        outbound: messages.filter((message) => message.direction === MessageDirection.OUTBOUND).length,
      },
    },
  });
});
