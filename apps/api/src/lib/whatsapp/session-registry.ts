import path from "path";
import fs from "fs/promises";
import QRCode from "qrcode";
import WhatsApp from "whatsapp-web.js";
import { ChatType, MessageDirection, MessageType, SessionStatus } from "@prisma/client";
import { wsEventNames } from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { getIo } from "../../ws/socket.js";
import { createNotification } from "../notifications.js";
import { AppError } from "../errors.js";
import { buildPuppeteerOptions, resolvePuppeteerExecutablePath } from "./puppeteer.js";

const { Client, LocalAuth, Location, MessageMedia } = WhatsApp;
type WhatsappClient = InstanceType<typeof Client>;
type WwebChat = Awaited<ReturnType<WhatsappClient["getChats"]>>[number];
type Contact = Awaited<ReturnType<WwebChat["getContact"]>>;
type Message = any;

type ManagedSession = {
  client: WhatsappClient;
  initialized: boolean;
};

class WhatsappSessionRegistry {
  private sessions = new Map<string, ManagedSession>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connectQueue: Promise<void> = Promise.resolve();
  private reconnectCooldown = new Map<string, number>();
  private readonly reconnectCooldownMs = 60_000;
  private readonly initializeTimeoutMs = 120_000;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      void this.runHeartbeat();
    }, 60_000);
  }

  async initializeExistingSessions() {
    const sessions = await prisma.whatsappSession.findMany({
      where: {
        status: {
          in: [
            SessionStatus.CONNECTED,
            SessionStatus.DISCONNECTED,
            SessionStatus.QR_READY,
            SessionStatus.PENDING,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    for (const session of sessions) {
      this.scheduleConnect(session.id, "restore");
    }
  }

  private scheduleConnect(sessionId: string, reason: string) {
    this.connectQueue = this.connectQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.connectSession(sessionId);
        } catch (error) {
          logger.error("Scheduled connect failed", { sessionId, reason, error });
        }
      });

    return this.connectQueue;
  }

  private scheduleReconnect(sessionId: string, reason: string) {
    this.connectQueue = this.connectQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.disconnectSession(sessionId).catch(() => undefined);
          await this.connectSession(sessionId);
        } catch (error) {
          logger.error("Scheduled reconnect failed", { sessionId, reason, error });
        }
      });

    return this.connectQueue;
  }

  async ensureSessionReady(sessionId: string) {
    const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new AppError(404, "Session not found");
    }

    const isActive = this.sessions.has(sessionId);
    const startableStatuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.DISCONNECTED,
      SessionStatus.QR_READY,
    ];
    const shouldStart = startableStatuses.includes(session.status);
    const isStalePending =
      session.status === SessionStatus.PENDING && Date.now() - session.updatedAt.getTime() > 45_000;

    if (isStalePending) {
      const lastAttempt = this.reconnectCooldown.get(sessionId) ?? 0;
      if (!isActive && Date.now() - lastAttempt > this.reconnectCooldownMs) {
        this.reconnectCooldown.set(sessionId, Date.now());
        this.scheduleReconnect(sessionId, "stale-pending");
      }
    } else if (!isActive && shouldStart) {
      this.scheduleConnect(sessionId, "ensure");
    }

    return session;
  }

  private async updateSession(sessionId: string, data: Record<string, unknown>) {
    try {
      const updated = await prisma.whatsappSession.update({
        where: { id: sessionId },
        data,
      });
      getIo().to(`session:${sessionId}`).emit(wsEventNames.sessionUpdate, updated);
      getIo().emit(wsEventNames.dashboardUpdated);
      return updated;
    } catch (error) {
      const prismaCode =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: string }).code)
          : undefined;

      if (prismaCode === "P2025") {
        logger.warn("Skipped session update because record was deleted", { sessionId });
        this.sessions.delete(sessionId);
        return null;
      }

      throw error;
    }
  }

  async shutdownAll() {
    for (const [sessionId, managed] of this.sessions.entries()) {
      await managed.client.destroy().catch(() => undefined);
      this.sessions.delete(sessionId);
    }
  }

  private buildClient(sessionId: string) {
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: sessionId,
        dataPath: path.resolve(process.cwd(), ".wwebjs_auth"),
      }),
      puppeteer: buildPuppeteerOptions(),
    });

    client.on("qr", async (qr) => {
      const qrDataUrl = await QRCode.toDataURL(qr);
      await this.updateSession(sessionId, {
        status: SessionStatus.QR_READY,
        qrCode: qr,
      });
      getIo()
        .to(`session:${sessionId}`)
        .emit(wsEventNames.qrUpdate, { sessionId, qrDataUrl, status: SessionStatus.QR_READY });
    });

    client.on("ready", async () => {
      const info = client.info;
      await this.updateSession(sessionId, {
        status: SessionStatus.CONNECTED,
        phoneNumber: info?.wid.user ?? null,
        qrCode: null,
        lastSeenAt: new Date(),
        heartbeatAt: new Date(),
      });
      await createNotification({
        title: "WhatsApp session connected",
        body: `Session is now connected${info?.wid.user ? ` as ${info.wid.user}` : ""}.`,
        type: "SUCCESS",
      });
    });

    client.on("authenticated", async () => {
      await this.updateSession(sessionId, {
        status: SessionStatus.CONNECTED,
        qrCode: null,
      });
    });

    client.on("auth_failure", async (message) => {
      await this.updateSession(sessionId, {
        status: SessionStatus.AUTH_FAILURE,
      });
      logger.warn("WhatsApp authentication failure", { sessionId, message });
    });

    client.on("disconnected", async (reason) => {
      const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
      await this.updateSession(sessionId, {
        status: SessionStatus.DISCONNECTED,
      });
      logger.warn("WhatsApp disconnected", { sessionId, reason });

      if (session?.autoReconnect) {
        this.sessions.delete(sessionId);
        setTimeout(() => {
          void this.connectSession(sessionId).catch((error) => {
            logger.error("Auto-reconnect failed", { sessionId, error });
          });
        }, 5_000);
      }
    });

    client.on("message", async (message) => {
      await this.persistInboundMessage(sessionId, message);
    });

    client.on("message_create", async (message) => {
      if (message.fromMe) {
        await this.persistOutboundEcho(sessionId, message);
      }
    });

    return client;
  }

  async createSession(name: string, ownerId?: string, autoReconnect = true) {
    const session = await prisma.whatsappSession.create({
      data: {
        name,
        ownerId,
        autoReconnect,
        status: SessionStatus.PENDING,
      },
    });

    this.scheduleConnect(session.id, "create");
    return session;
  }

  async reconnectSession(sessionId: string) {
    this.reconnectCooldown.set(sessionId, Date.now());
    this.scheduleReconnect(sessionId, "manual");
  }

  async connectSession(sessionId: string) {
    if (this.sessions.has(sessionId)) {
      return;
    }

    await this.updateSession(sessionId, {
      status: SessionStatus.PENDING,
    });

    const client = this.buildClient(sessionId);
    this.sessions.set(sessionId, { client, initialized: false });
    try {
      await Promise.race([
        client.initialize(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("WhatsApp client initialization timed out"));
          }, this.initializeTimeoutMs);
        }),
      ]);
      this.sessions.get(sessionId)!.initialized = true;
    } catch (error) {
      await client.destroy().catch(() => undefined);
      this.sessions.delete(sessionId);
      await this.updateSession(sessionId, {
        status: SessionStatus.DISCONNECTED,
      }).catch(() => undefined);
      const executablePath = resolvePuppeteerExecutablePath();
      logger.error("Failed to initialize WhatsApp session", { sessionId, error });
      throw new AppError(
        500,
        executablePath
          ? "Failed to start WhatsApp session"
          : "Failed to start WhatsApp session. Install Chrome or set PUPPETEER_EXECUTABLE_PATH.",
        error,
      );
    }
  }

  async disconnectSession(sessionId: string) {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return;
    }

    await managed.client.destroy();
    this.sessions.delete(sessionId);
    await this.updateSession(sessionId, {
      status: SessionStatus.DISCONNECTED,
      heartbeatAt: new Date(),
    });
  }

  async logoutSession(sessionId: string) {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new AppError(404, "Session is not active");
    }

    await managed.client.logout();
    await managed.client.destroy();
    this.sessions.delete(sessionId);
    await this.updateSession(sessionId, {
      status: SessionStatus.LOGGED_OUT,
      qrCode: null,
    });
  }

  async deleteSession(sessionId: string) {
    await this.disconnectSession(sessionId).catch(() => undefined);
    await prisma.message.deleteMany({ where: { sessionId } });
    await prisma.chat.deleteMany({ where: { sessionId } });
    await prisma.aiConversation.deleteMany({ where: { sessionId } });
    await prisma.whatsappSession.delete({ where: { id: sessionId } });

    const authDir = path.resolve(process.cwd(), ".wwebjs_auth", `session-${sessionId}`);
    await fs.rm(authDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async sendMessage(input: {
    sessionId: string;
    chatId: string;
    type: "TEXT" | "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "LOCATION" | "CONTACT";
    content?: string;
    mediaUrl?: string;
    mimeType?: string;
    fileName?: string;
    latitude?: number;
    longitude?: number;
    contactName?: string;
    contactPhone?: string;
    quotedMessageId?: string;
  }) {
    const managed = this.sessions.get(input.sessionId);
    if (!managed) {
      throw new AppError(400, "Session is not connected");
    }

    let payload: unknown = input.content;
    if (["IMAGE", "PDF", "AUDIO", "VIDEO"].includes(input.type)) {
      if (!input.mediaUrl || !input.mimeType) {
        throw new AppError(422, "Media URL and MIME type are required");
      }
      payload = await MessageMedia.fromUrl(input.mediaUrl, {
        unsafeMime: true,
        filename: input.fileName,
      });
    }

    if (input.type === "LOCATION") {
      if (input.latitude === undefined || input.longitude === undefined) {
        throw new AppError(422, "Coordinates are required");
      }
      payload = new Location(input.latitude, input.longitude);
    }

    if (input.type === "CONTACT") {
      if (!input.contactName || !input.contactPhone) {
        throw new AppError(422, "Contact name and phone are required");
      }
      payload = `${input.contactName}\n${input.contactPhone}`;
    }

    const result = await managed.client.sendMessage(input.chatId, payload as never, {
      quotedMessageId: input.quotedMessageId,
    });

    return this.persistMessageRecord(input.sessionId, result, MessageDirection.OUTBOUND);
  }

  async listChats(sessionId: string, search?: string) {
    return prisma.chat.findMany({
      where: {
        sessionId,
        OR: search
          ? [
              { name: { contains: search, mode: "insensitive" } },
              { externalId: { contains: search, mode: "insensitive" } },
            ]
          : undefined,
      },
      orderBy: { lastMessageAt: "desc" },
      include: { contact: true },
    });
  }

  async syncChats(sessionId: string) {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new AppError(400, "Session is not connected");
    }

    const chats = await managed.client.getChats();
    for (const chat of chats) {
      await this.upsertChat(sessionId, chat);
    }

    return this.listChats(sessionId);
  }

  private async upsertChat(sessionId: string, chat: WwebChat) {
    const contact = !chat.isGroup ? await chat.getContact().catch(() => null) : null;
    let contactId: string | undefined;

    if (contact) {
      const savedContact = await prisma.contact.upsert({
        where: { phoneNumber: contact.number || contact.id.user },
        update: {
          name: contact.pushname || contact.name || contact.number,
        },
        create: {
          name: contact.pushname || contact.name || contact.number,
          phoneNumber: contact.number || contact.id.user,
          labels: [],
        },
      });
      contactId = savedContact.id;
    }

    return prisma.chat.upsert({
      where: { externalId: chat.id._serialized },
      update: {
        name: chat.name,
        unreadCount: chat.unreadCount,
        archived: chat.archived,
        pinned: Boolean(chat.pinned),
        lastMessageAt: chat.timestamp ? new Date(chat.timestamp * 1000) : undefined,
        sessionId,
        contactId,
        type: chat.isGroup ? ChatType.GROUP : ChatType.DIRECT,
      },
      create: {
        externalId: chat.id._serialized,
        name: chat.name,
        unreadCount: chat.unreadCount,
        archived: chat.archived,
        pinned: Boolean(chat.pinned),
        lastMessageAt: chat.timestamp ? new Date(chat.timestamp * 1000) : undefined,
        sessionId,
        contactId,
        type: chat.isGroup ? ChatType.GROUP : ChatType.DIRECT,
      },
    });
  }

  private async persistInboundMessage(sessionId: string, message: Message) {
    await this.persistMessageRecord(sessionId, message, MessageDirection.INBOUND);
  }

  private async persistOutboundEcho(sessionId: string, message: Message) {
    const existing = await prisma.message.findFirst({
      where: { externalId: message.id.id, sessionId },
    });
    if (!existing) {
      await this.persistMessageRecord(sessionId, message, MessageDirection.OUTBOUND);
    }
  }

  private async persistMessageRecord(sessionId: string, message: Message, direction: MessageDirection) {
    const chat = await prisma.chat.upsert({
      where: { externalId: message.fromMe ? message.to : message.from },
      update: {
        name: message._data.notifyName ?? undefined,
        lastMessageAt: new Date(message.timestamp * 1000),
        sessionId,
      },
      create: {
        externalId: message.fromMe ? message.to : message.from,
        name: message._data.notifyName ?? undefined,
        sessionId,
        type: message.from.includes("@g.us") ? ChatType.GROUP : ChatType.DIRECT,
        lastMessageAt: new Date(message.timestamp * 1000),
      },
    });

    const saved = await prisma.message.upsert({
      where: { externalId: message.id.id },
      update: {
        content: message.body,
        status: message.ack?.toString() ?? "sent",
        metadata: message.rawData as object,
      },
      create: {
        externalId: message.id.id,
        sessionId,
        chatId: chat.id,
        direction,
        type: this.mapMessageType(message.type),
        content: message.body,
        status: message.ack?.toString() ?? "sent",
        sentAt: new Date(message.timestamp * 1000),
        metadata: message.rawData as object,
      },
    });

    getIo().to(`session:${sessionId}`).emit(wsEventNames.messageCreated, saved);
    getIo().to(`session:${sessionId}`).emit(wsEventNames.chatUpdated, chat);
    if (direction === MessageDirection.INBOUND) {
      await createNotification({
        title: "New WhatsApp message",
        body: chat.name ? `New message in ${chat.name}` : "You received a new message.",
        type: "INFO",
        metadata: { sessionId, chatId: chat.id, messageId: saved.id },
      });
    }
    return saved;
  }

  private async runHeartbeat() {
    for (const [sessionId, managed] of this.sessions.entries()) {
      if (!managed.initialized) {
        continue;
      }

      try {
        const state = await managed.client.getState();
        if (state === "CONNECTED") {
          await prisma.whatsappSession.update({
            where: { id: sessionId },
            data: { heartbeatAt: new Date(), lastSeenAt: new Date() },
          });
        }
      } catch (error) {
        logger.warn("Heartbeat check failed", { sessionId, error });
      }
    }
  }

  private mapMessageType(rawType: string): MessageType {
    switch (rawType) {
      case "image":
        return MessageType.IMAGE;
      case "video":
        return MessageType.VIDEO;
      case "audio":
      case "ptt":
        return MessageType.AUDIO;
      case "document":
        return MessageType.PDF;
      case "location":
        return MessageType.LOCATION;
      case "vcard":
        return MessageType.CONTACT;
      case "chat":
      default:
        return MessageType.TEXT;
    }
  }
}

export const whatsappSessionRegistry = new WhatsappSessionRegistry();
