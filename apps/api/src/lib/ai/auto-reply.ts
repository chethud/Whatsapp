import type { Chat, Message } from "@prisma/client";
import { AiProvider } from "@prisma/client";

import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { cleanWhatsAppReply } from "./clean-reply.js";
import { generateAllianceSquareFlowReply } from "./conversation-flow.js";

type SendMessageFn = (input: {
  sessionId: string;
  chatId: string;
  type: "TEXT" | "BUTTONS";
  content: string;
  buttons?: string[];
  allOptions?: string[];
}) => Promise<unknown>;

type EnsureConnectedFn = (sessionId: string) => Promise<void>;

const pendingReplies = new Map<string, NodeJS.Timeout>();
const activeChats = new Set<string>();
const repliedMessageIds = new Set<string>();
const recentReplyKeys = new Map<string, number>();
const GREETING_RE =
  /^(hi+|hii+|hello+|hey+|start(ing)?|good\s*(morning|afternoon|evening)|namaste|hola)[\s!?.]*$/i;

/**
 * Bot takes full control of every incoming DIRECT WhatsApp chat.
 * Replies are automatic — no manual dashboard action required.
 */
export function scheduleInboundAutoReply(input: {
  sessionId: string;
  chat: Chat;
  message: Message;
  sendMessage: SendMessageFn;
  ensureConnected?: EnsureConnectedFn;
}) {
  if (input.chat.type === "GROUP") {
    return;
  }

  // Hard dedupe: never reply twice to the same inbound message id.
  if (input.message.id && repliedMessageIds.has(input.message.id)) {
    logger.info("Skipping duplicate auto-reply for already handled message", {
      messageId: input.message.id,
      chatId: input.chat.id,
    });
    return;
  }

  const debounceKey = `${input.sessionId}:${input.chat.id}`;
  const existing = pendingReplies.get(debounceKey);
  if (existing) {
    clearTimeout(existing);
  }

  const content = input.message.content?.trim() ?? "";
  const delayMs = GREETING_RE.test(content) ? 700 : 900;

  logger.info("Inbound chat queued for bot takeover", {
    sessionId: input.sessionId,
    chatId: input.chat.id,
    externalId: input.chat.externalId,
    messageId: input.message.id,
    preview: content.slice(0, 80) || `[${input.message.type}]`,
  });

  pendingReplies.set(
    debounceKey,
    setTimeout(() => {
      pendingReplies.delete(debounceKey);
      // Claim the chat lock immediately to prevent parallel processors.
      if (activeChats.has(debounceKey)) {
        return;
      }
      activeChats.add(debounceKey);
      void processInboundAutoReply(input)
        .catch((error) => {
          logger.error("Auto-reply failed", {
            sessionId: input.sessionId,
            chatId: input.chat.id,
            error: error instanceof Error ? { name: error.name, message: error.message } : error,
          });
        })
        .finally(() => {
          activeChats.delete(debounceKey);
        });
    }, delayMs),
  );
}

async function processInboundAutoReply(input: {
  sessionId: string;
  chat: Chat;
  message: Message;
  sendMessage: SendMessageFn;
  ensureConnected?: EnsureConnectedFn;
}) {
  if (input.message.id && repliedMessageIds.has(input.message.id)) {
    return;
  }
  // Reserve this message id up front so a parallel path cannot send again.
  markHandled(input.message.id);

  try {
    await ensureAutoReplyEnabled();

    if (input.ensureConnected) {
      await input.ensureConnected(input.sessionId);
    }

    const latestInbound = await prisma.message.findFirst({
      where: {
        sessionId: input.sessionId,
        chatId: input.chat.id,
        direction: "INBOUND",
        deleted: false,
      },
      orderBy: { sentAt: "desc" },
    });

    const userMessage =
      latestInbound?.content?.trim() ||
      input.message.content?.trim() ||
      (input.message.type !== "TEXT" ? "Hello, I sent a message" : "");

    if (!userMessage) {
      await sendOnce(
        input,
        `Hi there! Welcome to Alliance Square! 🏡

We’d love to help you find the perfect property. May I know your name?`,
      );
      return;
    }

    const flowResult = await generateAllianceSquareFlowReply({
      sessionId: input.sessionId,
      chatId: input.chat.id,
      userMessage,
    });

    const cleaned = (flowResult.replies?.length ? flowResult.replies : [flowResult.reply])
      .map((item) =>
        cleanWhatsAppReply(item, {
          allowQualificationLanguage: true,
          // Keep full scripted lines (name ask uses "sir!" which would otherwise truncate).
          preserveScript: true,
        }),
      )
      .filter(Boolean);

    const replies =
      cleaned.length > 0
        ? cleaned
        : [
            `Hi there! Welcome to Alliance Square! 🏡

We’d love to help you find the perfect property. May I know your name?`,
          ];

    const replyDedupeKey = `${input.sessionId}:${input.chat.id}:${replies.join("|")}:${flowResult.choiceButtons?.buttonOptions?.join(",") ?? ""}`;
    const lastSentAt = recentReplyKeys.get(replyDedupeKey) ?? 0;
    // Only skip the exact same reply text — never block the next flow step.
    if (Date.now() - lastSentAt < 12_000) {
      logger.info("Skipping duplicate identical reply within 12s", {
        chatId: input.chat.id,
        reply: replies[0]?.slice(0, 80),
      });
      return;
    }

    logger.info("Bot sending auto-reply with full chat control", {
      sessionId: input.sessionId,
      chatId: input.chat.id,
      externalId: input.chat.externalId,
      stage: flowResult.stage,
      analysis: flowResult.analysis,
      userMessage: userMessage.slice(0, 120),
      replyCount: replies.length,
      reply: replies[0]?.slice(0, 160),
      hasChoiceButtons: Boolean(flowResult.choiceButtons),
    });

    // Send the understood conversational reply; soft buttons are optional only.
    const primary = replies[0];
    if (flowResult.choiceButtons?.buttonOptions?.length) {
      await sendOnce(
        input,
        primary,
        flowResult.choiceButtons.buttonOptions,
        flowResult.choiceButtons.options,
      );
    } else {
      await sendOnce(input, primary);
    }
    recentReplyKeys.set(replyDedupeKey, Date.now());
  } finally {
    // lock released by caller finally
  }
}

function markHandled(messageId?: string | null) {
  if (!messageId) {
    return;
  }
  repliedMessageIds.add(messageId);
  // Prevent unbounded growth.
  if (repliedMessageIds.size > 2000) {
    const first = repliedMessageIds.values().next().value;
    if (first) {
      repliedMessageIds.delete(first);
    }
  }
}

async function sendOnce(
  input: {
    sessionId: string;
    chat: Chat;
    sendMessage: SendMessageFn;
    ensureConnected?: EnsureConnectedFn;
  },
  content: string,
  buttons?: string[],
  allOptions?: string[],
) {
  const payload = buttons?.length
    ? {
        sessionId: input.sessionId,
        chatId: input.chat.externalId,
        type: "BUTTONS" as const,
        content,
        buttons,
        allOptions,
      }
    : {
        sessionId: input.sessionId,
        chatId: input.chat.externalId,
        type: "TEXT" as const,
        content,
      };

  try {
    await input.sendMessage(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only reconnect+retry for true connection issues — never for persist/fromMe errors after send.
    const isConnectionError =
      /not connected|Session is not connected|Target closed|Session closed|timed out|ECONNREFUSED/i.test(
        message,
      );

    if (!isConnectionError) {
      logger.warn("Auto-reply send reported error after likely delivery; not retrying", {
        sessionId: input.sessionId,
        chatId: input.chat.id,
        error: message,
      });
      return;
    }

    logger.warn("Auto-reply connection error, restoring session and retrying once", {
      sessionId: input.sessionId,
      chatId: input.chat.id,
      error: message,
    });

    if (input.ensureConnected) {
      await input.ensureConnected(input.sessionId);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await input.sendMessage(payload);
  }
}

async function ensureAutoReplyEnabled() {
  const existing = await prisma.appSetting.findFirst();
  if (!existing) {
    return prisma.appSetting.create({
      data: {
        id: "default-settings",
        businessName: "Alliance Square",
        timezone: "Asia/Kolkata",
        aiAutoReplyEnabled: true,
        defaultAiProvider: AiProvider.GEMINI,
      },
    });
  }

  if (
    !existing.aiAutoReplyEnabled ||
    existing.defaultAiProvider !== AiProvider.GEMINI ||
    existing.businessName !== "Alliance Square"
  ) {
    return prisma.appSetting.update({
      where: { id: existing.id },
      data: {
        businessName: "Alliance Square",
        aiAutoReplyEnabled: true,
        defaultAiProvider: AiProvider.GEMINI,
      },
    });
  }

  return existing;
}
