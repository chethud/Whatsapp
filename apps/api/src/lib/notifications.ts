import { NotificationType } from "@prisma/client";
import { wsEventNames } from "@whatsapp/shared";

import { prisma } from "../config/prisma.js";
import { getIo } from "../ws/socket.js";

export async function createNotification(input: {
  title: string;
  body: string;
  type?: NotificationType;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const notification = await prisma.notification.create({
    data: {
      title: input.title,
      body: input.body,
      type: input.type ?? NotificationType.INFO,
      userId: input.userId ?? undefined,
      metadata: input.metadata as object | undefined,
    },
  });

  getIo().emit(wsEventNames.notificationCreated, notification);
  if (input.userId) {
    getIo().to(`user:${input.userId}`).emit(wsEventNames.notificationCreated, notification);
  }

  return notification;
}
