import OpenAI from "openai";
import { type AiProvider } from "@prisma/client";

import { env } from "../../config/env.js";
import { AppError } from "../errors.js";

type AiRequest = {
  provider: AiProvider | "OPENAI" | "GEMINI" | "COMPATIBLE";
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  maxTokens: number;
};

export async function generateChatCompletion(input: AiRequest) {
  if (input.provider === "OPENAI" || input.provider === "COMPATIBLE") {
    const client = new OpenAI({
      apiKey: input.provider === "OPENAI" ? env.OPENAI_API_KEY : env.COMPATIBLE_AI_API_KEY,
      baseURL: input.provider === "COMPATIBLE" ? env.COMPATIBLE_AI_BASE_URL : undefined,
    });

    const response = await client.chat.completions.create({
      model: input.model ?? "gpt-4o-mini",
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new AppError(502, "AI provider returned an empty response");
    }

    return {
      text: choice.message.content,
      model: response.model,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
    };
  }

  if (input.provider === "GEMINI") {
    if (!env.GEMINI_API_KEY) {
      throw new AppError(500, "GEMINI_API_KEY is not configured");
    }

    const model = input.model ?? "gemini-1.5-flash";
    const contents = input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    const systemInstruction = input.messages.find((message) => message.role === "system")?.content;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          contents,
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxTokens,
          },
        }),
      },
    );

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new AppError(502, payload.error?.message ?? "Gemini request failed");
    }

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new AppError(502, "Gemini returned an empty response");
    }

    return {
      text,
      model,
      promptTokens: payload.usageMetadata?.promptTokenCount,
      completionTokens: payload.usageMetadata?.candidatesTokenCount,
    };
  }

  throw new AppError(400, "Unsupported AI provider");
}
