import { Router } from "express";
import {
  createKnowledgeDocumentSchema,
  createPromptTemplateSchema,
  generateAiReplySchema,
} from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { generateChatCompletion } from "../../lib/ai/provider.js";

export const aiRouter = Router();

aiRouter.use(requireAuth, requirePermission("ai.manage"));

aiRouter.get("/templates", async (_req, res) => {
  const templates = await prisma.promptTemplate.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: templates });
});

aiRouter.post("/templates", validateBody(createPromptTemplateSchema), async (req, res) => {
  const template = await prisma.promptTemplate.create({ data: req.body });
  res.status(201).json({ success: true, data: template });
});

aiRouter.get("/knowledge-base", async (_req, res) => {
  const docs = await prisma.knowledgeDocument.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: docs });
});

aiRouter.post("/knowledge-base", validateBody(createKnowledgeDocumentSchema), async (req, res) => {
  const doc = await prisma.knowledgeDocument.create({ data: req.body });
  res.status(201).json({ success: true, data: doc });
});

aiRouter.post("/reply", validateBody(generateAiReplySchema), async (req, res, next) => {
  try {
    const [conversation, docs, templates] = await Promise.all([
      prisma.aiConversation.upsert({
        where: {
          sessionId_chatId: {
            sessionId: req.body.sessionId,
            chatId: req.body.chatId,
          },
        },
        update: {},
        create: {
          sessionId: req.body.sessionId,
          chatId: req.body.chatId,
        },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
      }),
      prisma.knowledgeDocument.findMany({ take: 5, orderBy: { updatedAt: "desc" } }),
      prisma.promptTemplate.findMany({ take: 3, orderBy: { updatedAt: "desc" } }),
    ]);

    const knowledgeContext = docs.map((doc) => `${doc.title}: ${doc.content}`).join("\n\n");
    const templateContext = templates.map((template) => `${template.name}: ${template.content}`).join("\n\n");

    const result = await generateChatCompletion({
      provider: req.body.provider,
      temperature: req.body.temperature,
      maxTokens: req.body.maxTokens,
      messages: [
        {
          role: "system",
          content:
            `Use the business prompt templates and knowledge base to answer accurately.\n\nTemplates:\n${templateContext}\n\nKnowledge:\n${knowledgeContext}`,
        },
        ...conversation.messages.map((message) => ({
          role: message.role as "system" | "user" | "assistant",
          content: message.content,
        })),
        {
          role: "user",
          content: req.body.prompt,
        },
      ],
    });

    await prisma.aiMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          role: "user",
          content: req.body.prompt,
        },
        {
          conversationId: conversation.id,
          role: "assistant",
          content: result.text,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        },
      ],
    });

    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        reply: result.text,
        model: result.model,
      },
    });
  } catch (error) {
    next(error);
  }
});
