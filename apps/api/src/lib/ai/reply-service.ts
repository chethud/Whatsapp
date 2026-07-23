import type { AiProvider } from "@prisma/client";

import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { generateChatCompletion } from "./provider.js";
import { buildRealEstateSystemPrompt } from "./system-prompt.js";
import { cleanWhatsAppReply } from "./clean-reply.js";

const LEAD_DATA_REGEX = /\n?---LEAD_DATA---\n([\s\S]*)$/i;

type LeadData = {
  intent?: string;
  budget?: string;
  location?: string;
  propertyType?: string;
  timeline?: string;
  leadScore?: number;
  escalate?: boolean;
};

type GenerateReplyInput = {
  sessionId: string;
  chatId: string;
  userMessage: string;
  provider?: AiProvider;
  temperature?: number;
  maxTokens?: number;
};

export async function generateRealEstateReply(input: GenerateReplyInput) {
  const settings = await prisma.appSetting.findFirst();
  if (!settings) {
    throw new Error("App settings are not configured");
  }

  const provider = input.provider ?? settings.defaultAiProvider;

  const [conversation, recentMessages, templates, knowledgeDocs, chat] = await Promise.all([
    prisma.aiConversation.upsert({
      where: {
        sessionId_chatId: {
          sessionId: input.sessionId,
          chatId: input.chatId,
        },
      },
      update: {},
      create: {
        sessionId: input.sessionId,
        chatId: input.chatId,
      },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
    }),
    prisma.message.findMany({
      where: { sessionId: input.sessionId, chatId: input.chatId, deleted: false },
      orderBy: { sentAt: "desc" },
      take: 12,
    }),
    prisma.promptTemplate.findMany({ take: 5, orderBy: { updatedAt: "desc" } }),
    prisma.knowledgeDocument.findMany({ take: 10, orderBy: { updatedAt: "desc" } }),
    prisma.chat.findUnique({
      where: { id: input.chatId },
      include: { contact: true },
    }),
  ]);

  if (conversation.escalatedToHuman) {
    // Allow greetings / new messages to resume bot replies.
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { escalatedToHuman: false },
    });
  }

  const whatsappContext = recentMessages
    .reverse()
    .filter((message) => message.content?.trim())
    .map((message) => ({
      role: message.direction === "INBOUND" ? ("user" as const) : ("assistant" as const),
      content: message.content!.trim(),
    }));

  const systemPrompt = buildRealEstateSystemPrompt({ settings, templates, knowledgeDocs });

  // Use WhatsApp chat history as the conversation source, then the latest customer text.
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `${systemPrompt}\n\nReply specifically to the customer's latest message below.`,
    },
    ...whatsappContext.slice(-10),
  ];

  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "user" || lastMessage.content !== input.userMessage) {
    messages.push({
      role: "user",
      content: `Customer message: ${input.userMessage}`,
    });
  } else {
    lastMessage.content = `Customer message: ${input.userMessage}`;
  }

  const result = await generateChatCompletion({
    provider,
    temperature: input.temperature ?? 0.3,
    maxTokens: input.maxTokens ?? 80,
    messages,
  });

  const { replyText, leadData } = parseLeadData(result.text);
  const cleanedReply = cleanWhatsAppReply(replyText);

  if (!cleanedReply) {
    return {
      reply: "Our sales expert will share details. Shall I arrange a callback?",
      model: result.model,
      conversationId: conversation.id,
      escalated: false,
    };
  }

  await prisma.aiMessage.createMany({
    data: [
      {
        conversationId: conversation.id,
        role: "user",
        content: input.userMessage,
      },
      {
        conversationId: conversation.id,
        role: "assistant",
        content: cleanedReply,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      },
    ],
  });

  if (leadData) {
    await applyLeadData({
      conversationId: conversation.id,
      chatContactId: chat?.contactId,
      leadData,
    });
  }

  return {
    reply: cleanedReply,
    model: result.model,
    conversationId: conversation.id,
    escalated: leadData?.escalate ?? false,
  };
}

function parseLeadData(rawText: string): { replyText: string; leadData: LeadData | null } {
  const match = rawText.match(LEAD_DATA_REGEX);
  if (!match) {
    return { replyText: cleanWhatsAppReply(rawText), leadData: null };
  }

  const replyText = rawText.slice(0, match.index).trim();
  try {
    const leadData = JSON.parse(match[1].trim()) as LeadData;
    return { replyText: cleanWhatsAppReply(replyText), leadData };
  } catch {
    logger.warn("Failed to parse LEAD_DATA from AI response");
    return { replyText: cleanWhatsAppReply(rawText), leadData: null };
  }
}

async function applyLeadData(input: {
  conversationId: string;
  chatContactId?: string | null;
  leadData: LeadData;
}) {
  const { leadData } = input;
  const qualification = {
    intent: leadData.intent ?? "unknown",
    budget: leadData.budget ?? "",
    location: leadData.location ?? "",
    propertyType: leadData.propertyType ?? "",
    timeline: leadData.timeline ?? "",
    updatedAt: new Date().toISOString(),
  };

  await prisma.aiConversation.update({
    where: { id: input.conversationId },
    data: {
      leadQualification: qualification,
      escalatedToHuman: leadData.escalate === true,
    },
  });

  if (input.chatContactId) {
    const score = Math.min(100, Math.max(0, Number(leadData.leadScore) || 0));
    await prisma.contact.update({
      where: { id: input.chatContactId },
      data: {
        leadScore: score > 0 ? score : undefined,
        customFields: qualification,
      },
    });
  }
}
