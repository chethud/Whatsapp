import { Router } from "express";
import {
  createKnowledgeDocumentSchema,
  createPromptTemplateSchema,
  generateAiReplySchema,
} from "@whatsapp/shared";

import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { generateRealEstateReply } from "../../lib/ai/reply-service.js";
import { generateAllianceSquareFlowReply } from "../../lib/ai/conversation-flow.js";

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
    const settings = await prisma.appSetting.findFirst();
    const provider = req.body.provider ?? settings?.defaultAiProvider ?? "GEMINI";
    const geminiReady = Boolean(env.GEMINI_API_KEY?.trim());
    // Default to scripted Alliance Square flow so Generate works without Gemini.
    // Set body.useGemini=true to force the free-form Gemini reply path when a key exists.
    const forceGemini = req.body.useGemini === true;

    if (!forceGemini || !geminiReady) {
      const flow = await generateAllianceSquareFlowReply({
        sessionId: req.body.sessionId,
        chatId: req.body.chatId,
        userMessage: req.body.prompt,
      });

      return res.json({
        success: true,
        data: {
          conversationId: flow.conversationId,
          reply: flow.replies?.join("\n\n") ?? flow.reply,
          model: geminiReady ? "alliance-square-flow" : "alliance-square-flow (no GEMINI_API_KEY)",
          stage: flow.stage,
          suggestedProperties: flow.suggestedProperties,
          geminiConfigured: geminiReady,
        },
      });
    }

    const result = await generateRealEstateReply({
      sessionId: req.body.sessionId,
      chatId: req.body.chatId,
      userMessage: req.body.prompt,
      provider,
      temperature: req.body.temperature,
      maxTokens: req.body.maxTokens,
    });

    if (!result) {
      return res.status(409).json({
        success: false,
        error: "This conversation was escalated to a human agent.",
      });
    }

    res.json({
      success: true,
      data: {
        conversationId: result.conversationId,
        reply: result.reply,
        model: result.model,
        geminiConfigured: geminiReady,
      },
    });
  } catch (error) {
    next(error);
  }
});
