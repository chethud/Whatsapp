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
import { scheduleInboundAutoReply } from "../ai/auto-reply.js";
import { resolvePuppeteerExecutablePath } from "./puppeteer.js";
import { getWhatsappClientOptions, WWEBJS_AUTH_PATH } from "./client-options.js";

const { Client, LocalAuth, Location, MessageMedia, Buttons, List } = WhatsApp;
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
  private manualDisconnects = new Set<string>();
  private readonly initializeTimeoutMs = 120_000;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      void this.runHeartbeat();
    }, 60_000);
  }

  async initializeExistingSessions() {
    const sessions = await prisma.whatsappSession.findMany({
      where: {
        OR: [
          { status: SessionStatus.CONNECTED },
          { status: SessionStatus.QR_READY },
          {
            autoReconnect: true,
            phoneNumber: { not: null },
            status: { notIn: [SessionStatus.LOGGED_OUT, SessionStatus.AUTH_FAILURE] },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    for (const session of sessions) {
      this.scheduleConnect(session.id, "restore", { restore: this.isPairedSession(session) });
    }
  }

  private isPairedSession(session: { phoneNumber: string | null }) {
    return Boolean(session.phoneNumber);
  }

  async restoreSessionIfNeeded(sessionId: string) {
    if (this.sessions.has(sessionId)) {
      return;
    }

    const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return;
    }

    const shouldRestore =
      session.status === SessionStatus.CONNECTED ||
      session.status === SessionStatus.QR_READY ||
      (session.autoReconnect &&
        this.isPairedSession(session) &&
        session.status !== SessionStatus.LOGGED_OUT);

    if (shouldRestore) {
      this.scheduleConnect(sessionId, "restore", { restore: this.isPairedSession(session) });
    }
  }

  private scheduleConnect(
    sessionId: string,
    reason: string,
    options?: { restore?: boolean },
  ) {
    this.connectQueue = this.connectQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.connectSession(sessionId, options);
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
          await this.disconnectSession(sessionId, { keepAutoReconnect: true }).catch(() => undefined);
          await this.connectSession(sessionId, { restore: false });
        } catch (error) {
          logger.error("Scheduled reconnect failed", { sessionId, reason, error });
        }
      });

    return this.connectQueue;
  }

  async getSession(sessionId: string) {
    const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new AppError(404, "Session not found");
    }
    return session;
  }

  async startSession(sessionId: string) {
    const session = await this.getSession(sessionId);
    const startableStatuses: SessionStatus[] = [
      SessionStatus.PENDING,
      SessionStatus.DISCONNECTED,
      SessionStatus.QR_READY,
    ];

    if (!this.sessions.has(sessionId) && startableStatuses.includes(session.status)) {
      const restore = this.isPairedSession(session);
      if (restore) {
        await prisma.whatsappSession.update({
          where: { id: sessionId },
          data: { autoReconnect: true },
        });
      }
      this.scheduleConnect(sessionId, "start", { restore });
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
        dataPath: WWEBJS_AUTH_PATH,
      }),
      ...getWhatsappClientOptions(),
    });

    client.on("qr", async (qr) => {
      const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280, errorCorrectionLevel: "M" });
      getIo()
        .to(`session:${sessionId}`)
        .emit(wsEventNames.qrUpdate, { sessionId, qrDataUrl, status: SessionStatus.QR_READY });
      await this.updateSession(sessionId, {
        status: SessionStatus.QR_READY,
        qrCode: qr,
      });
    });

    client.on("ready", async () => {
      const info = client.info;
      await this.updateSession(sessionId, {
        status: SessionStatus.CONNECTED,
        phoneNumber: info?.wid.user ?? null,
        qrCode: null,
        autoReconnect: true,
        lastSeenAt: new Date(),
        heartbeatAt: new Date(),
      });
      await createNotification({
        title: "WhatsApp session connected",
        body: `Session is now connected${info?.wid.user ? ` as ${info.wid.user}` : ""}.`,
        type: "SUCCESS",
      });

      // WhatsApp Web chat list often loads a few seconds after "ready".
      // Retry sync until chats appear (or attempts are exhausted).
      void this.schedulePostReadyChatSync(sessionId);
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
      if (this.manualDisconnects.has(sessionId)) {
        return;
      }

      const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
      await this.updateSession(sessionId, {
        status: SessionStatus.DISCONNECTED,
      });
      logger.warn("WhatsApp disconnected", { sessionId, reason });

      if (session?.autoReconnect && this.isPairedSession(session)) {
        this.sessions.delete(sessionId);
        setTimeout(() => {
          void this.connectSession(sessionId, { restore: true }).catch((error) => {
            logger.error("Auto-reconnect failed", { sessionId, error });
          });
        }, 5_000);
      }
    });

    client.on("message", async (message) => {
      // Only customer messages — bot owns the reply path.
      if (message.fromMe) {
        return;
      }
      try {
      await this.persistInboundMessage(sessionId, message);
      } catch (error) {
        logger.error("Failed to process inbound WhatsApp message", {
          sessionId,
          error: error instanceof Error ? { name: error.name, message: error.message } : error,
        });
      }
    });

    client.on("message_create", async (message) => {
      if (message.fromMe) {
        await this.persistOutboundEcho(sessionId, message);
      }
    });

    client.on("vote_update", async (vote) => {
      try {
        await this.handlePollVote(sessionId, vote);
      } catch (error) {
        logger.error("Failed to process poll vote", {
          sessionId,
          error: error instanceof Error ? { name: error.name, message: error.message } : error,
        });
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

    void this.connectSession(session.id).catch((error) => {
      logger.error("Initial session connect failed", { sessionId: session.id, error });
    });
    return session;
  }

  async reconnectSession(sessionId: string) {
    this.scheduleReconnect(sessionId, "manual");
  }

  async connectSession(sessionId: string, options?: { restore?: boolean }) {
    if (this.sessions.has(sessionId)) {
      return;
    }

    const existing = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
    const isRestore = options?.restore ?? this.isPairedSession(existing ?? { phoneNumber: null });

    if (!isRestore) {
      await this.updateSession(sessionId, {
        status: SessionStatus.PENDING,
      });
    }

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

  async disconnectSession(sessionId: string, options?: { keepAutoReconnect?: boolean }) {
    this.manualDisconnects.add(sessionId);

    const managed = this.sessions.get(sessionId);
    if (managed) {
      await managed.client.destroy().catch(() => undefined);
      this.sessions.delete(sessionId);
    }

    await this.updateSession(sessionId, {
      status: SessionStatus.DISCONNECTED,
      autoReconnect: options?.keepAutoReconnect ? true : false,
      heartbeatAt: new Date(),
    });

    this.manualDisconnects.delete(sessionId);
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
      autoReconnect: false,
      phoneNumber: null,
    });
  }

  async deleteSession(sessionId: string) {
    await this.disconnectSession(sessionId).catch(() => undefined);
    await prisma.message.deleteMany({ where: { sessionId } });
    await prisma.chat.deleteMany({ where: { sessionId } });
    await prisma.aiConversation.deleteMany({ where: { sessionId } });
    await prisma.whatsappSession.delete({ where: { id: sessionId } });

    const authDir = path.resolve(WWEBJS_AUTH_PATH, `session-${sessionId}`);
    await fs.rm(authDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async sendMessage(input: {
    sessionId: string;
    chatId: string;
    type: "TEXT" | "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "LOCATION" | "CONTACT" | "BUTTONS";
    content?: string;
    buttons?: string[];
    allOptions?: string[];
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

    if (input.type === "BUTTONS") {
      const buttonOptions = (input.buttons ?? []).map((label) => label.trim()).filter(Boolean).slice(0, 3);
      const allOptions = (input.allOptions?.length ? input.allOptions : buttonOptions)
        .map((label) => label.trim())
        .filter(Boolean);
      const body = input.content?.trim() || "Please choose an option:";
      if (!buttonOptions.length && !allOptions.length) {
        const result = await managed.client.sendMessage(input.chatId, body as never, {
          quotedMessageId: input.quotedMessageId,
        });
        return this.persistOutboundResult(input, result);
      }
      return this.sendChoiceMessage(
        managed.client,
        { ...input, type: "BUTTONS" as const },
        body,
        buttonOptions,
        allOptions,
      );
    }

    const result = await managed.client.sendMessage(input.chatId, payload as never, {
      quotedMessageId: input.quotedMessageId,
    });

    return this.persistOutboundResult(input, result);
  }

  private async persistOutboundResult(
    input: {
      sessionId: string;
      chatId: string;
      type: "TEXT" | "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "LOCATION" | "CONTACT" | "BUTTONS";
      content?: string;
      buttons?: string[];
      mediaUrl?: string;
      mimeType?: string;
      fileName?: string;
      latitude?: number;
      longitude?: number;
    },
    result: Message | null | undefined,
  ) {
    // Never invent a second bubble with "opt1 | opt2" — that caused duplicate replies.
    const localContent = (input.content ?? "").trim();

    try {
      if (!result) {
        return await this.persistLocalOutbound({
          ...input,
          type: input.type === "BUTTONS" ? "TEXT" : input.type,
          content: localContent,
        });
      }
      return await this.persistMessageRecord(input.sessionId, result, MessageDirection.OUTBOUND);
    } catch (error) {
      logger.warn("WhatsApp message sent but local persist failed", {
        sessionId: input.sessionId,
        chatId: input.chatId,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      });
      return this.persistLocalOutbound({
        ...input,
        type: input.type === "BUTTONS" ? "TEXT" : input.type,
        content: localContent,
      });
    }
  }

  /** Prefer Buttons, then List (supports Other), then numbered text. Avoid polls — votes often don't continue the chat. */
  private async sendChoiceMessage(
    client: WhatsappClient,
    input: {
      sessionId: string;
      chatId: string;
      type: "BUTTONS";
      content?: string;
      buttons?: string[];
      allOptions?: string[];
      quotedMessageId?: string;
    },
    body: string,
    buttonOptions: string[],
    allOptions: string[],
  ) {
    const listOptions = allOptions.length ? allOptions : buttonOptions;
    const attempts: Array<{ mode: string; build: () => unknown }> = [
      {
        mode: "buttons",
        build: () =>
          new Buttons(
            body,
            buttonOptions.map((label) => ({ id: label, body: label })),
            "",
            "Tap to select",
          ),
      },
      {
        mode: "list",
        build: () =>
          new List(
            body,
            "Select",
            [
              {
                title: "Options",
                rows: listOptions.map((label) => ({
                  id: label,
                  title: label,
                  description: "",
                })),
              },
            ],
            "Alliance Square",
            "",
          ),
      },
      {
        mode: "text",
        // Keep only the human sentence — never append keyword menus.
        build: () => body,
      },
    ];

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        const payload = attempt.build();
        const result = await client.sendMessage(input.chatId, payload as never, {
          quotedMessageId: input.quotedMessageId,
        });
        // Empty result often means the interactive payload was rejected after a partial send.
        // Fall through to the next mode instead of saving a fake duplicate bubble.
        if (!result) {
          throw new Error("Empty WhatsApp send result");
        }
        logger.info("Choice message sent", {
          sessionId: input.sessionId,
          chatId: input.chatId,
          mode: attempt.mode,
          options: attempt.mode === "buttons" ? buttonOptions : listOptions,
        });
        return this.persistOutboundResult(input, result);
      } catch (error) {
        lastError = error;
        logger.warn("Choice message send attempt failed", {
          sessionId: input.sessionId,
          attempt: attempt.mode,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    throw lastError instanceof Error ? lastError : new AppError(500, "Failed to send choice options");
  }

  private async handlePollVote(sessionId: string, vote: any) {
    const selected = this.extractPollSelection(vote);
    if (!selected) {
      logger.info("Ignoring poll vote without selectable option", { sessionId });
      return;
    }

    const chatExternalId = await this.resolvePollVoteChatId(sessionId, vote);
    if (!chatExternalId || chatExternalId.includes("@g.us")) {
      logger.warn("Poll vote missing chat id", {
        sessionId,
        voter: vote?.voter,
        parentTo: vote?.parentMessage?.to,
        parentFrom: vote?.parentMessage?.from,
      });
      return;
    }

    const managed = this.sessions.get(sessionId);
    const myId = managed?.client?.info?.wid?._serialized;
    if (myId && (vote?.voter === myId || chatExternalId === myId)) {
      return;
    }

    const chat = await this.findOrCreateDirectChat(sessionId, chatExternalId);

    const externalId = `poll-vote-${String(vote?.parentMsgKey?.id || vote?.parentMessage?.id?.id || "x")}-${String(vote?.voter || "u")}-${selected}-${String(vote?.interractedAtTs || Date.now())}`;
    const saved = await prisma.message.upsert({
      where: { externalId },
      update: { content: selected },
      create: {
        externalId,
        sessionId,
        chatId: chat.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        content: selected,
        status: "received",
        sentAt: new Date(),
        metadata: { source: "poll_vote", selected },
      },
    });

    logger.info("Poll vote converted to inbound message", {
      sessionId,
      chatId: chat.id,
      externalId: chat.externalId,
      selected,
    });

    getIo().to(`session:${sessionId}`).emit(wsEventNames.messageCreated, saved);
    getIo().to(`session:${sessionId}`).emit(wsEventNames.chatUpdated, chat);

    scheduleInboundAutoReply({
      sessionId,
      chat,
      message: saved,
      sendMessage: (payload) => this.sendMessage(payload),
      ensureConnected: (id) => this.restoreSessionIfNeeded(id),
    });
  }

  private extractPollSelection(vote: any): string | null {
    const named = vote?.selectedOptions?.find((option: any) => typeof option?.name === "string" && option.name.trim());
    if (named?.name) {
      return String(named.name).trim();
    }

    const localId =
      vote?.selectedOptions?.[0]?.localId ??
      vote?.selectedOptions?.[0]?.id ??
      vote?.selectedOptionLocalIds?.[0];
    const pollOptions = vote?.parentMessage?.pollOptions || vote?.parentMessage?._data?.pollOptions || [];
    if (localId !== undefined && Array.isArray(pollOptions)) {
      const match = pollOptions.find(
        (option: any) => option?.localId === localId || option?.id === localId || option?.name,
      );
      const byLocal = pollOptions.find((option: any) => option?.localId === localId);
      const option = byLocal || match;
      if (option?.name) {
        return String(option.name).trim();
      }
    }

    return null;
  }

  private async resolvePollVoteChatId(sessionId: string, vote: any): Promise<string | undefined> {
    const parent = vote?.parentMessage;
    // Poll was sent by us → customer chat is usually `to`.
    const candidates = [
      parent?.to,
      parent?.id?.remote,
      parent?._data?.to,
      vote?.parentMsgKey?.remote,
      vote?.voter,
      parent?.from,
    ].filter((value): value is string => typeof value === "string" && value.length > 3);

    for (const candidate of candidates) {
      const existing = await prisma.chat.findFirst({
        where: { sessionId, externalId: candidate },
      });
      if (existing) {
        return existing.externalId;
      }
    }

    // Match by phone digits when @c.us / @lid ids differ.
    for (const candidate of candidates) {
      const digits = candidate.replace(/\D/g, "");
      if (digits.length < 8) {
        continue;
      }
      const chats = await prisma.chat.findMany({
        where: { sessionId, type: ChatType.DIRECT },
        include: { contact: true },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
      });
      const matched = chats.find((chat) => {
        const idDigits = chat.externalId.replace(/\D/g, "");
        const phoneDigits = chat.contact?.phoneNumber?.replace(/\D/g, "") ?? "";
        return idDigits.endsWith(digits.slice(-10)) || phoneDigits.endsWith(digits.slice(-10));
      });
      if (matched) {
        return matched.externalId;
      }
    }

    return candidates[0];
  }

  private async findOrCreateDirectChat(sessionId: string, chatExternalId: string) {
    const existing = await prisma.chat.findFirst({
      where: { sessionId, externalId: chatExternalId },
    });
    if (existing) {
      return prisma.chat.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date() },
      });
    }

    return prisma.chat.upsert({
      where: { externalId: chatExternalId },
      update: { lastMessageAt: new Date(), sessionId },
      create: {
        externalId: chatExternalId,
        sessionId,
        type: ChatType.DIRECT,
        lastMessageAt: new Date(),
      },
    });
  }

  private async persistLocalOutbound(input: {
    sessionId: string;
    chatId: string;
    type: "TEXT" | "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "LOCATION" | "CONTACT";
    content?: string;
    mediaUrl?: string;
    mimeType?: string;
    fileName?: string;
    latitude?: number;
    longitude?: number;
  }) {
    const chat =
      (await prisma.chat.findFirst({
        where: {
          sessionId: input.sessionId,
          OR: [{ externalId: input.chatId }, { id: input.chatId }],
        },
      })) ??
      (await prisma.chat.create({
        data: {
          externalId: input.chatId,
          sessionId: input.sessionId,
          type: input.chatId.includes("@g.us") ? ChatType.GROUP : ChatType.DIRECT,
          lastMessageAt: new Date(),
        },
      }));

    const saved = await prisma.message.create({
      data: {
        sessionId: input.sessionId,
        chatId: chat.id,
        direction: MessageDirection.OUTBOUND,
        type: input.type,
        content: input.content,
        mediaUrl: input.mediaUrl,
        mimeType: input.mimeType,
        fileName: input.fileName,
        latitude: input.latitude,
        longitude: input.longitude,
        status: "sent",
        sentAt: new Date(),
      },
    });

    getIo().to(`session:${input.sessionId}`).emit(wsEventNames.messageCreated, saved);
    getIo().to(`session:${input.sessionId}`).emit(wsEventNames.chatUpdated, chat);
    return saved;
  }

  async listChats(sessionId: string, search?: string) {
    return prisma.chat.findMany({
      where: {
        sessionId,
        OR: search
          ? [
              { name: { contains: search, mode: "insensitive" } },
              { externalId: { contains: search, mode: "insensitive" } },
              { contact: { phoneNumber: { contains: search, mode: "insensitive" } } },
              { contact: { name: { contains: search, mode: "insensitive" } } },
            ]
          : undefined,
      },
      orderBy: { lastMessageAt: "desc" },
      include: { contact: true },
    });
  }

  async syncChats(sessionId: string) {
    const session = await prisma.whatsappSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new AppError(404, "WhatsApp session not found");
    }
    if (session.status !== SessionStatus.CONNECTED) {
      throw new AppError(400, "Connect WhatsApp before syncing chats");
    }

    try {
      const managed = await this.ensureClientReady(sessionId);
      const state = await managed.client.getState().catch(() => null);
      if (state && state !== "CONNECTED") {
        throw new AppError(400, `WhatsApp is ${state}. Wait until CONNECTED, then sync again.`);
      }

      await this.waitForChatStore(managed.client);

      let chats = await this.fetchChatsSafely(managed.client);
      // WhatsApp Web sometimes hydrates the Store a few seconds after ready.
      if (chats.length === 0) {
        for (let attempt = 0; attempt < 8 && chats.length === 0; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await this.waitForChatStore(managed.client);
          chats = await this.fetchChatsSafely(managed.client);
        }
      }

      let synced = 0;
      let messagesSynced = 0;

      for (const chat of chats) {
        try {
          const savedChat = await this.upsertChatRecord(sessionId, chat);
          synced += 1;
          // Sync messages for the first N chats fully; skip heavy history for the rest to finish faster.
          if (synced <= 120) {
            messagesSynced += await this.syncRecentMessagesForChat(
              sessionId,
              managed.client,
              savedChat.externalId,
              savedChat.id,
            );
          }
        } catch (error) {
          logger.warn("Skipped chat during sync", {
            sessionId,
            chatId: chat.externalId,
            error: serializeError(error),
          });
        }
      }

      const items = await this.listChats(sessionId);
      logger.info("Synced chats from WhatsApp", {
        sessionId,
        synced,
        total: chats.length,
        messagesSynced,
        inboxCount: items.length,
      });

      try {
        getIo().to(`session:${sessionId}`).emit(wsEventNames.chatUpdated, {
          sessionId,
          synced,
          inboxCount: items.length,
        });
        getIo().emit(wsEventNames.dashboardUpdated);
      } catch {
        // socket may not be ready during early boot
      }

      return {
        items,
        synced,
        totalFromPhone: chats.length,
        messagesSynced,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to sync chats from WhatsApp", {
        sessionId,
        error: serializeError(error),
      });
      throw new AppError(502, `Failed to sync chats from WhatsApp: ${errorMessage(error)}`);
    }
  }

  private async schedulePostReadyChatSync(sessionId: string) {
    const attemptDelaysMs = [5_000, 12_000, 22_000, 35_000];

    for (let index = 0; index < attemptDelaysMs.length; index++) {
      const waitMs =
        index === 0 ? attemptDelaysMs[0] : attemptDelaysMs[index] - attemptDelaysMs[index - 1];
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      try {
        const result = await this.syncChats(sessionId);
        logger.info("Post-ready chat sync attempt finished", {
          sessionId,
          attempt: index + 1,
          synced: result.synced,
          inboxCount: result.items.length,
        });
        if (result.synced > 0 || result.items.length > 0) {
          return;
        }
      } catch (error) {
        logger.warn("Post-ready chat sync attempt failed", {
          sessionId,
          attempt: index + 1,
          error: serializeError(error),
        });
      }
    }
  }

  private async ensureClientReady(sessionId: string) {
    if (!this.sessions.get(sessionId)?.initialized) {
      await this.restoreSessionIfNeeded(sessionId);
    }

    for (let attempt = 0; attempt < 30; attempt++) {
    const managed = this.sessions.get(sessionId);
      if (managed?.initialized) {
        const state = await managed.client.getState().catch(() => null);
        if (!state || state === "CONNECTED") {
          return managed;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new AppError(400, "WhatsApp client is not ready in memory. Reconnect the session and try again.");
  }

  private async waitForChatStore(client: WhatsappClient) {
    const page = (client as { pupPage?: { evaluate: <T>(fn: () => T | Promise<T>) => Promise<T> } }).pupPage;
    if (!page) {
      return;
    }

    for (let attempt = 0; attempt < 12; attempt++) {
      const ready = await page
        .evaluate(() => {
          const store = (globalThis as unknown as {
            Store?: {
              Chat?: {
                getModelsArray?: () => unknown[];
                models?: unknown[] | Record<string, unknown>;
              };
            };
          }).Store;
          const fromArray = store?.Chat?.getModelsArray?.() ?? [];
          const models = Array.isArray(fromArray) && fromArray.length
            ? fromArray
            : Array.isArray(store?.Chat?.models)
              ? store.Chat.models
              : Object.values((store?.Chat?.models as Record<string, unknown>) || {});
          return Array.isArray(models) && models.length > 0;
        })
        .catch(() => false);

      if (ready) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  private async syncRecentMessagesForChat(
    sessionId: string,
    client: WhatsappClient,
    chatExternalId: string,
    chatId: string,
  ) {
    try {
      const chat = await client.getChatById(chatExternalId);
      const messages = await chat.fetchMessages({ limit: 80 });
      let count = 0;

      for (const message of messages) {
        try {
          const direction = message.fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND;
          const externalMessageId =
            message.id?._serialized ||
            message.id?.id ||
            `${chatExternalId}-${message.timestamp}-${message.body?.slice(0, 12)}`;
          if (!externalMessageId) {
            continue;
          }

          await prisma.message.upsert({
            where: { externalId: String(externalMessageId) },
            update: {
              content: message.body ?? undefined,
              status: message.ack?.toString() ?? "synced",
              chatId,
              sessionId,
            },
            create: {
              externalId: String(externalMessageId),
              sessionId,
              chatId,
              direction,
              type: this.mapMessageType(message.type || "chat"),
              content: message.body ?? null,
              status: message.ack?.toString() ?? "synced",
              sentAt: message.timestamp ? new Date(message.timestamp * 1000) : new Date(),
            },
          });
          count += 1;
        } catch {
          // skip individual message failures
        }
      }

      return count;
    } catch (error) {
      logger.warn("Failed to sync messages for chat", {
        sessionId,
        chatExternalId,
        error: serializeError(error),
      });
      return 0;
    }
  }

  private async fetchChatsSafely(client: WhatsappClient) {
    const byId = new Map<
      string,
      {
        externalId: string;
        name?: string | null;
        isGroup: boolean;
        unreadCount: number;
        archived: boolean;
        pinned: boolean;
        timestamp?: number;
        phoneNumber?: string;
        getContact?: () => Promise<Contact | null>;
      }
    >();

    try {
      const chats = await client.getChats();
      for (const chat of chats) {
        try {
          const base = this.mapWwebChat(chat);
          if (!base.isGroup && (!base.phoneNumber || looksLikeWhatsappId(base.phoneNumber))) {
            const resolved = await this.resolvePhoneFromClient(client, base.externalId).catch(() => undefined);
            if (resolved) {
              base.phoneNumber = resolved;
            }
          }
          byId.set(base.externalId, base);
    } catch (error) {
          logger.warn("Skipped chat while mapping getChats result", {
            error: serializeError(error),
          });
        }
      }
    } catch (primaryError) {
      logger.warn("client.getChats failed, will use Store fallback", {
        error: serializeError(primaryError),
      });
    }

    // Always merge Store chats — getChats can succeed with [] while Store still has history.
    const storeChats = await this.fetchChatsFromStore(client).catch((error) => {
      logger.warn("Store chat fallback failed", { error: serializeError(error) });
      return [] as Array<{
        externalId: string;
        name?: string | null;
        isGroup: boolean;
        unreadCount: number;
        archived: boolean;
        pinned: boolean;
        timestamp?: number;
        phoneNumber?: string;
      }>;
    });

    for (const chat of storeChats) {
      const existing = byId.get(chat.externalId);
      if (!existing) {
        byId.set(chat.externalId, chat);
        continue;
      }
      byId.set(chat.externalId, {
        ...existing,
        name: existing.name || chat.name,
        phoneNumber: existing.phoneNumber || chat.phoneNumber,
        unreadCount: Math.max(existing.unreadCount, chat.unreadCount),
        archived: existing.archived || chat.archived,
        pinned: existing.pinned || chat.pinned,
        timestamp: Math.max(existing.timestamp ?? 0, chat.timestamp ?? 0) || existing.timestamp,
      });
    }

    const merged = [...byId.values()];
    for (const chat of merged) {
      if (!chat.isGroup && (!chat.phoneNumber || looksLikeWhatsappId(chat.phoneNumber))) {
        const resolved = await this.resolvePhoneFromClient(client, chat.externalId).catch(() => undefined);
        if (resolved) {
          chat.phoneNumber = resolved;
        }
      }
    }

    return merged;
  }

  private async fetchChatsFromStore(client: WhatsappClient) {
    const page = (client as { pupPage?: { evaluate: <T>(fn: () => T | Promise<T>) => Promise<T> } }).pupPage;
    if (!page) {
      return [];
    }

    return page.evaluate(() => {
      type StoreChat = {
        id?: { _serialized?: string; server?: string; user?: string };
        name?: string;
        formattedTitle?: string;
        isGroup?: boolean;
        unreadCount?: number;
        archived?: boolean;
        pinned?: boolean;
        timestamp?: number;
        t?: number;
        contact?: {
          number?: string;
          phoneNumber?: string;
          name?: string;
          pushname?: string;
        };
      };

      const root = globalThis as unknown as {
        Store?: {
          Chat?: {
            getModelsArray?: () => StoreChat[];
            models?: StoreChat[] | Record<string, StoreChat>;
            _models?: StoreChat[];
            toArray?: () => StoreChat[];
          };
          Contact?: {
            get?: (id: unknown) => {
              number?: string;
              phoneNumber?: string;
              name?: string;
              pushname?: string;
            } | undefined;
          };
        };
        WWebJS?: {
          getChats?: () => Promise<Array<{ id?: { _serialized?: string } } & StoreChat>>;
        };
      };

      const store = root.Store;
      const candidates: StoreChat[] = [];
      const pushAll = (items: unknown) => {
        if (!items) {
          return;
        }
        if (Array.isArray(items)) {
          candidates.push(...(items as StoreChat[]));
          return;
        }
        if (typeof items === "object") {
          candidates.push(...(Object.values(items) as StoreChat[]));
        }
      };

      pushAll(store?.Chat?.getModelsArray?.());
      pushAll(store?.Chat?.toArray?.());
      pushAll(store?.Chat?._models);
      pushAll(store?.Chat?.models);

      const seen = new Set<string>();
      return candidates
        .map((chat) => {
          const externalId = chat?.id?._serialized;
          if (!externalId || seen.has(externalId)) {
            return null;
          }
          seen.add(externalId);

          if (externalId.includes("status@broadcast") || externalId.endsWith("@newsletter")) {
            return null;
          }

          const isGroup = Boolean(chat.isGroup || chat.id?.server === "g.us");
          const contact = chat.contact || (chat.id && store?.Contact?.get?.(chat.id)) || undefined;
          const phoneRaw =
            contact?.number ||
            contact?.phoneNumber ||
            (chat.id?.server === "c.us" ? chat.id.user : undefined);

          return {
            externalId,
            name: chat.name || chat.formattedTitle || contact?.pushname || contact?.name || undefined,
            isGroup,
            unreadCount: chat.unreadCount ?? 0,
            archived: Boolean(chat.archived),
            pinned: Boolean(chat.pinned),
            timestamp: chat.timestamp ?? chat.t,
            phoneNumber: phoneRaw ? String(phoneRaw).replace(/\D/g, "") : undefined,
          };
        })
        .filter((chat): chat is NonNullable<typeof chat> => Boolean(chat));
    });
  }

  private async resolvePhoneFromClient(client: WhatsappClient, externalId: string) {
    const page = (client as { pupPage?: { evaluate: <T>(fn: (id: string) => T | Promise<T>, id: string) => Promise<T> } })
      .pupPage;
    if (!page) {
      return undefined;
    }

    const phone = await page.evaluate((id) => {
      type PhoneContact = {
        number?: string;
        phoneNumber?: string;
        id?: { user?: string; server?: string };
      };
      const store = (globalThis as unknown as {
        Store?: {
          WidFactory?: { createWid?: (value: string) => unknown };
          Contact?: {
            get?: (wid: unknown) => PhoneContact | undefined;
            find?: (wid: unknown) => Promise<PhoneContact | null>;
          };
          Chat?: {
            get?: (wid: unknown) => { contact?: PhoneContact } | undefined;
          };
        };
      }).Store;

      try {
        const wid = store?.WidFactory?.createWid?.(id) ?? id;
        const contact = store?.Contact?.get?.(wid) || store?.Chat?.get?.(wid)?.contact;
        const raw = contact?.number || contact?.phoneNumber || contact?.id?.user;
        if (raw && !String(raw).includes("@") && !String(id).endsWith("@lid")) {
          return String(raw).replace(/\D/g, "");
        }
        if (raw && String(contact?.id?.server) === "c.us") {
          return String(raw).replace(/\D/g, "");
        }
        if (contact?.number) {
          return String(contact.number).replace(/\D/g, "");
        }
        if (contact?.phoneNumber) {
          return String(contact.phoneNumber).replace(/\D/g, "");
        }
      } catch {
        return null;
      }
      return null;
    }, externalId);

    return phone || undefined;
  }

  private mapWwebChat(chat: WwebChat) {
    const externalId = chat.id._serialized;
    const isGroup = Boolean(chat.isGroup);
    let phoneNumber: string | undefined;

    if (!isGroup) {
      if (externalId.endsWith("@c.us")) {
        phoneNumber = externalId.split("@")[0]?.replace(/\D/g, "");
      }
    }

    return {
      externalId,
      name: chat.name || undefined,
      isGroup,
      unreadCount: chat.unreadCount ?? 0,
      archived: Boolean(chat.archived),
      pinned: Boolean(chat.pinned),
      timestamp: chat.timestamp,
      phoneNumber,
      getContact: () => chat.getContact(),
    };
  }

  private async upsertChat(sessionId: string, chat: WwebChat) {
    return this.upsertChatRecord(sessionId, this.mapWwebChat(chat));
  }

  private async upsertChatRecord(
    sessionId: string,
    chat: {
      externalId: string;
      name?: string | null;
      isGroup: boolean;
      unreadCount: number;
      archived: boolean;
      pinned: boolean;
      timestamp?: number;
      phoneNumber?: string;
      getContact?: () => Promise<Contact | null>;
    },
  ) {
    let contactId: string | undefined;
    let displayName = chat.name?.trim() || undefined;

    if (!chat.isGroup) {
      const contact = chat.getContact ? await chat.getContact().catch(() => null) : null;
      const phoneNumber = normalizePhoneNumber(
        contact?.number ||
          (contact as { phoneNumber?: string } | null)?.phoneNumber ||
          chat.phoneNumber ||
          (chat.externalId.endsWith("@c.us") ? chat.externalId.split("@")[0] : undefined),
      );

      if (phoneNumber) {
        const contactLabel =
          [contact?.pushname, contact?.name].find((value) => value && !looksLikeWhatsappId(value)) ||
          phoneNumber;

        const savedContact = await prisma.contact.upsert({
          where: { phoneNumber },
          update: { name: contactLabel },
          create: {
            name: contactLabel,
            phoneNumber,
            labels: [],
          },
        });
        contactId = savedContact.id;
        // Heading should show the phone number for direct chats.
        displayName = formatPhoneDisplay(phoneNumber);
      } else if (!displayName || looksLikeWhatsappId(displayName)) {
        displayName = chat.externalId.includes("@")
          ? chat.externalId.split("@")[0]
          : chat.externalId;
      }
    }

    return prisma.chat.upsert({
      where: { externalId: chat.externalId },
      update: {
        name: displayName,
        unreadCount: chat.unreadCount,
        archived: chat.archived,
        pinned: chat.pinned,
        lastMessageAt: chat.timestamp ? new Date(chat.timestamp * 1000) : undefined,
        sessionId,
        ...(contactId ? { contactId } : {}),
        type: chat.isGroup ? ChatType.GROUP : ChatType.DIRECT,
      },
      create: {
        externalId: chat.externalId,
        name: displayName,
        unreadCount: chat.unreadCount,
        archived: chat.archived,
        pinned: chat.pinned,
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
    const externalId = message?.id?.id || message?.id?._serialized;
    const body = typeof message?.body === "string" ? message.body.trim() : "";

    if (externalId) {
    const existing = await prisma.message.findFirst({
        where: { externalId: String(externalId), sessionId },
      });
      if (existing) {
        return;
      }
    }

    // Avoid double-saving bot sends: sendMessage may persist first, then WhatsApp echoes.
    if (body) {
      const recentOutbound = await prisma.message.findMany({
        where: {
          sessionId,
          direction: MessageDirection.OUTBOUND,
          sentAt: { gte: new Date(Date.now() - 20_000) },
        },
        orderBy: { sentAt: "desc" },
        take: 8,
      });
      const recentDuplicate = recentOutbound.find((item) => {
        const existing = (item.content ?? "").trim();
    if (!existing) {
          return false;
        }
        if (existing === body) {
          return true;
        }
        // Choice fallbacks / local persist can differ slightly from WhatsApp echo body.
        return existing.startsWith(body) || body.startsWith(existing.split("\n")[0] ?? existing);
      });
      if (recentDuplicate) {
        if (externalId && !recentDuplicate.externalId) {
          await prisma.message.update({
            where: { id: recentDuplicate.id },
            data: { externalId: String(externalId) },
          });
        }
        return;
      }
    }

    if (!externalId) {
      return;
    }

    await this.persistMessageRecord(sessionId, message, MessageDirection.OUTBOUND).catch((error) => {
      logger.warn("Failed to persist outbound echo", {
        sessionId,
        error: error instanceof Error ? error.message : error,
      });
    });
  }

  private async persistMessageRecord(sessionId: string, message: Message, direction: MessageDirection) {
    if (!message) {
      throw new Error("Cannot persist empty WhatsApp message payload");
    }

    const chatExternalId =
      direction === MessageDirection.OUTBOUND
        ? message.to || message.from || message.id?.remote || message.id?._serialized
        : message.from || message.to;

    if (!chatExternalId || typeof chatExternalId !== "string") {
      throw new Error("WhatsApp message is missing chat id");
    }

    const isGroup = chatExternalId.includes("@g.us");
    let displayName = message._data?.notifyName as string | undefined;
    let contactId: string | undefined;

    if (!isGroup) {
      const managed = this.sessions.get(sessionId);
      const phoneFromId = chatExternalId.endsWith("@c.us")
        ? normalizePhoneNumber(chatExternalId.split("@")[0])
        : undefined;
      const phoneFromClient = managed
        ? await this.resolvePhoneFromClient(managed.client, chatExternalId).catch(() => undefined)
        : undefined;
      const phoneNumber = phoneFromClient || phoneFromId;

      if (phoneNumber) {
        displayName = formatPhoneDisplay(phoneNumber);
        const contactLabel =
          displayName && message._data?.notifyName && !looksLikeWhatsappId(String(message._data.notifyName))
            ? String(message._data.notifyName)
            : phoneNumber;
        const savedContact = await prisma.contact.upsert({
          where: { phoneNumber },
          update: { name: contactLabel },
          create: {
            name: contactLabel,
            phoneNumber,
            labels: [],
          },
        });
        contactId = savedContact.id;
      } else if (displayName && looksLikeWhatsappId(displayName)) {
        displayName = chatExternalId.split("@")[0];
      }
    }

    const sentAt = message.timestamp ? new Date(message.timestamp * 1000) : new Date();

    const chat = await prisma.chat.upsert({
      where: { externalId: chatExternalId },
      update: {
        name: displayName ?? undefined,
        lastMessageAt: sentAt,
        sessionId,
        ...(contactId ? { contactId } : {}),
      },
      create: {
        externalId: chatExternalId,
        name: displayName ?? undefined,
        sessionId,
        type: isGroup ? ChatType.GROUP : ChatType.DIRECT,
        lastMessageAt: sentAt,
        contactId,
      },
    });

    const externalMessageId =
      message.id?.id || message.id?._serialized || message.id || `local-${Date.now()}-${Math.random()}`;

    const saved = await prisma.message.upsert({
      where: { externalId: String(externalMessageId) },
      update: {
        content: this.extractInboundContent(message) ?? message.body,
        status: message.ack?.toString() ?? "sent",
        metadata: (message.rawData as object) ?? undefined,
      },
      create: {
        externalId: String(externalMessageId),
        sessionId,
        chatId: chat.id,
        direction,
        type: this.mapMessageType(message.type || "chat"),
        content: this.extractInboundContent(message),
        status: message.ack?.toString() ?? "sent",
        sentAt,
        metadata: (message.rawData as object) ?? undefined,
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

      scheduleInboundAutoReply({
        sessionId,
        chat,
        message: saved,
        sendMessage: (payload) => this.sendMessage(payload),
        ensureConnected: (id) => this.restoreSessionIfNeeded(id),
      });
    }
    return saved;
  }

  private extractInboundContent(message: Message): string | null {
    const body = typeof message?.body === "string" ? message.body.trim() : "";
    if (body) {
      return body;
    }
    const selectedButton = typeof message?.selectedButtonId === "string" ? message.selectedButtonId.trim() : "";
    if (selectedButton) {
      return selectedButton;
    }
    const selectedRow =
      typeof message?.listResponse?.singleSelectReply?.selectedRowId === "string"
        ? message.listResponse.singleSelectReply.selectedRowId.trim()
        : typeof message?.selectedRowId === "string"
          ? message.selectedRowId.trim()
          : "";
    if (selectedRow) {
      return selectedRow;
    }
    return null;
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

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "object" && error !== null) {
    return {
      ...error,
      message: errorMessage(error),
    };
  }

  return { message: String(error) };
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Unknown WhatsApp sync error";
}

function looksLikeWhatsappId(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("@") ||
    normalized.includes("lid") ||
    normalized.endsWith("c.us") ||
    normalized.endsWith("g.us")
  );
}

function normalizePhoneNumber(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const raw = String(value).trim();
  if (raw.includes("@lid") || raw.toLowerCase().endsWith("lid")) {
    return undefined;
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return undefined;
  }

  return digits;
}

function formatPhoneDisplay(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length > 10) {
    return `+${digits}`;
  }
  return digits;
}

export const whatsappSessionRegistry = new WhatsappSessionRegistry();
