import type { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";
import { createNotification } from "../notifications.js";
import { analyzeCustomerMessage, decideNextAction, type MessageAnalysis } from "./analyze-message.js";
import {
  suggestProperties,
  findPropertyByName,
  formatPropertyDetails,
  formatFullRecommendation,
  buildCategoryOverviewText,
  type AllianceProperty,
} from "./alliance-properties.js";
import { choiceButtonsForAction, plotSizesForBudget, REPLY_NUMBER_HINT } from "./choice-options.js";
import { answerOutOfBoxQuestion } from "./out-of-box-replies.js";
import {
  propertySetupLabel,
  softCallbackAsk,
  type PropertySetup,
} from "./multi-plot.js";
import { getTimeAwareCallSlots, scheduleClosingMessage } from "./call-time.js";
import { generateChatCompletion } from "./provider.js";
import { cleanWhatsAppReply } from "./clean-reply.js";

export type FlowStage =
  | "greeting"
  | "awaiting_name"
  | "awaiting_intent"
  | "awaiting_purpose"
  | "awaiting_dimensions"
  | "awaiting_budget"
  | "awaiting_callback"
  | "awaiting_details_confirm"
  | "awaiting_call_time"
  | "awaiting_multi_plot_type"
  | "awaiting_side_by_side_details"
  | "awaiting_multi_location_purpose"
  | "awaiting_multi_location_details"
  | "handed_over";

export type LeadQualificationState = {
  stage?: FlowStage;
  purpose?: "investment" | "home" | "both" | "";
  customerName?: string;
  intent?: string;
  budget?: string;
  dimensions?: string;
  location?: string;
  propertyType?: string;
  purposeExplained?: boolean;
  phoneNumber?: string;
  preferredCallTime?: "morning" | "evening" | "";
  chosenCallSlot?: string;
  propertySetup?: PropertySetup;
  multiPlotPurposes?: string;
  preferredLocations?: string;
  suggestedProperties?: string[];
  timeline?: string;
  lastAnalysis?: string;
  lastSummary?: string;
  updatedAt?: string;
};

function purposeLabel(purpose?: string) {
  if (purpose === "home") return "Build a Home (Family First)";
  if (purpose === "both") return "Hybrid (Living + Growth)";
  if (purpose === "investment") return "Investment (Wealth Booster)";
  return "Not specified";
}

function phoneFromExternalId(externalId?: string | null) {
  if (!externalId) return "";
  const raw = externalId.replace(/@.*/, "").replace(/\D/g, "");
  return raw || "";
}

function formatLeadSummary(state: LeadQualificationState) {
  const layout = state.suggestedProperties?.[0] || "To be confirmed";
  return `📋 Here is a quick summary of your requirements:

• Name: ${state.customerName || "—"}
• Property Setup: ${propertySetupLabel(state.propertySetup)}
• Goal: ${state.multiPlotPurposes || purposeLabel(state.purpose)}
• Preferred Locations: ${state.preferredLocations || state.location || layout || "—"}
• Plot Sizes: ${state.dimensions || "—"}
• Budget: ${state.budget || "—"}

Are these details correct?`;
}

const PURPOSE_MENU = `To help us guide you best, what are you looking for?

1️⃣ Investment Property (Wealth Booster)
2️⃣ Build a Home Property (Family First)
3️⃣ Hybrid Option (Living + Growth)
4️⃣ Need help deciding? (Tell me the difference)${REPLY_NUMBER_HINT}`;

/** Fallback scripts (also preferred outbound for key flow moments). */
const FALLBACK_REPLIES = {
  greeting: (userMessage?: string) => {
    const intent =
      /\b(looking|buy|purchase|plot|plots|muda|invest|home|property|site)\b/i.test(userMessage || "");
    if (intent) {
      return `Welcome to Alliance Square! 🏡 You’ve come to the right place—we have excellent MUDA-approved and high-growth sites available right now.

May I know your name so I can guide you better?`;
    }
    return `Hi there! Welcome to Alliance Square! 🏡

We’d love to help you find the perfect property in and around Mysuru. May I know your name?`;
  },
  clarifyName: "Sure — what name should I call you?",
  welcomeNamed: (name: string) =>
    `Great to connect with you, ${name}! Finding the right property is one of the smartest wealth moves you can make.

${PURPOSE_MENU}`,
  askHelp: PURPOSE_MENU,
  purposeQuestion: PURPOSE_MENU,
  dimensionsQuestion: (budget?: string, purpose?: string) => {
    const sizes = plotSizesForBudget(budget);
    const marks = ["1️⃣", "2️⃣", "3️⃣"];
    const blurbs: Record<string, string> =
      purpose === "investment"
        ? {
            "20x30": "Compact entry — strong % ROI potential",
            "30x40": "Popular size for balanced appreciation",
            "40x60": "Larger holding for premium corridor plays",
          }
        : {
            "20x30": "Ideal for compact, budget-friendly homes",
            "30x40": "The classic choice for spacious family living",
            "40x60": "Premium space for a larger family home",
          };
    const budgetLine = budget
      ? `${budget.replace(/\blacs?\b/i, "Lakhs").replace(/\blakhs?\b/i, "Lakhs")} is a sweet spot for Mysuru right now! 🎯 ${
          purpose === "investment"
            ? "It lets you enter growth corridors early before retail prices peak."
            : "It gives you access to secure, well-connected neighborhoods."
        }\n\n`
      : "";
    const hint =
      sizes.length >= 3
        ? "\n\n*(You can simply reply with 1, 2, or 3)*"
        : "\n\n*(You can simply reply with 1 or 2)*";
    return `${budgetLine}Based on your budget, which plot size would you prefer?

${sizes
  .map((size, index) => {
    const blurb = blurbs[size];
    return `${marks[index] ?? `${index + 1}.`} ${size}${blurb ? ` (${blurb})` : ""}`;
  })
  .join("\n")}${hint}`;
  },
  budgetQuestion: (purpose?: string) => {
    if (purpose === "investment") {
      return `What approximate budget do you have allocated for this investment?

1️⃣ Under ₹20 Lakhs
2️⃣ ₹20 Lakhs – ₹35 Lakhs
3️⃣ ₹35 Lakhs+
4️⃣ Type custom amount

*(You can simply reply with 1, 2, 3, or 4, or type your budget)*`;
    }
    return "What budget do you have in mind for this? You can just type the approximate amount (e.g., 25 Lakhs, 40 Lakhs).";
  },
  clarifyPurpose: `No rush at all. Would you like:

1️⃣ Investment Property (Wealth Booster)
2️⃣ Build a Home Property (Family First)
3️⃣ Hybrid Option (Living + Growth)
4️⃣ Need help deciding?${REPLY_NUMBER_HINT}`,
  clarifyDimensions: (budget?: string, purpose?: string) =>
    FALLBACK_REPLIES.dimensionsQuestion(budget, purpose),
  clarifyBudget: (purpose?: string) =>
    purpose === "investment"
      ? FALLBACK_REPLIES.budgetQuestion("investment")
      : "No problem — please type your budget in your own words, like 28 Lakhs or 45 Lakhs.",
  askOtherDimensions: "Sure — just tell me the size you’re looking for.",
  askOtherBudget: "Sure — just type the budget you have in mind.",
  companyDetails: (name?: string) => {
    const who = name?.trim() ? `, ${name.trim()}` : "";
    return `Glad you asked${who}! Choosing the right plot depends entirely on your goals. Here’s a quick breakdown:

📈 Investment Plot (Wealth Booster)
High-growth corridors & industrial belts — strong appreciation over 3–7 years (e.g., Hunsur Road, Nanjangud).

🏡 Build a Home Plot (Family First)
Ready-to-build spots near Ring Road, schools, and hospitals (e.g., Srirampura, Bogadi).

🔄 Hybrid Option
A site you can build on today that still appreciates steadily (e.g., MUDA layouts, Kushalnagar Hwy Exit).

Which of these sounds closer to what you have in mind today?

1️⃣ Investment Plot
2️⃣ Build a Home
3️⃣ Hybrid
4️⃣ Speak with advisor${REPLY_NUMBER_HINT}`;
  },
  investmentAffirm: (name?: string) => {
    const who = name?.trim() ? `, ${name.trim()}` : "";
    return `Smart move${who}! Land in high-growth corridors is one of the highest-performing assets right now. 📈

In our top investment belts near Mysuru, historical trends show a steady appreciation of ₹100 – ₹200 per sq. ft. even in conservative conditions within 12 months. In high-demand phases, we see surges of ₹500 – ₹600 per sq. ft. Over a 3 to 4-year holding period, it delivers massive ROI potential.

What approximate budget do you have allocated for this investment?

1️⃣ Under ₹20 Lakhs
2️⃣ ₹20 Lakhs – ₹35 Lakhs
3️⃣ ₹35 Lakhs+
4️⃣ Type custom amount

*(You can simply reply with 1, 2, 3, or 4, or type your budget)*`;
  },
  homeAffirm: (name?: string) => {
    const who = name?.trim() ? `, ${name.trim()}` : "";
    return `Wonderful${who}! Building your dream home in a secure, well-connected community is a wonderful milestone. 🏡

We focus on MUDA-approved, construction-ready plots near Ring Road with schools and hospitals nearby.

What budget do you have in mind for this? You can just type the approximate amount (e.g., 25 Lakhs, 40 Lakhs).`;
  },
  hybridAffirm: (name?: string) => {
    const who = name?.trim() ? `, ${name.trim()}` : "";
    return `Great choice${who}! Hybrid plots combine peace-of-mind living with steady, reliable land value growth. 🌟

What budget do you have in mind for this? You can just type the approximate amount (e.g., 25 Lakhs, 40 Lakhs).`;
  },
  requestAdvisor:
    "Of course — I’d be happy to connect you with an advisor. Let me confirm your details first.",
  askCallback: () => softCallbackAsk("your selected plot preference", getTimeAwareCallSlots().askLine),
  deferCallback:
    "No problem at all. Whenever you’re ready, just say yes and I’ll arrange the callback. Or tell me what else you’d like to know.",
  correctDetails:
    "No worries — please reply with the correct name, budget, plot size, property setup, or locations, and I’ll update it.",
  confirmCallback: (name?: string) => {
    const slots = getTimeAwareCallSlots();
    return `Perfect${name?.trim() ? `, ${name.trim()}` : ""}! 📞 Our Mysuru specialist will give you a quick call shortly.

${slots.askLine}`;
  },
  scheduleClosing: (state: LeadQualificationState) =>
    scheduleClosingMessage({
      name: state.customerName,
      chosenSlot: state.chosenCallSlot || (state.preferredCallTime === "morning" ? "Tomorrow morning" : "This evening"),
      propertySetup: propertySetupLabel(state.propertySetup),
      layout: state.suggestedProperties?.[0],
    }),
  askCallTime: () => getTimeAwareCallSlots().askLine,
  askMultiPlotType: `Yes, absolutely! 🏡🏡 Buying two plots is a fantastic strategy for long-term wealth and flexibility.

Are you looking for two side-by-side plots in the same layout, or plots in different locations?

1️⃣ Side-by-side (same layout)
2️⃣ Different locations

*(Reply with 1 for Same Layout or 2 for Different Locations)*`,
  askSideBySideDetails:
    "Got it! Side-by-side plots are perfect for building a larger home or holding one next door for family.\n\nWhat total budget or plot dimensions do you have in mind for both plots together? (for example: 60 Lakhs total, 30x40 each)",
  clarifySideBySideDetails:
    "Could you share the total budget and preferred size for the side-by-side plots? (e.g., 60 Lakhs total, two 30x40s)",
  askMultiLocationPurpose:
    "Understood! Diversifying across two different locations is a smart way to balance immediate family needs with high long-term appreciation. 📈🏡\n\nTo help us narrow down the best options: Are you looking for 1 Investment plot + 1 Build-a-Home plot, or something else?",
  clarifyMultiLocationPurpose:
    "Just to confirm — is it 1 Investment + 1 Build-a-Home, or a different mix for the two locations?",
  askMultiLocationDetails:
    "Got it! That’s a very popular and practical setup.\n\nWhich specific areas or corridors in/around Mysuru are you considering for each, and what is your approximate budget for both plots?",
  clarifyMultiLocationDetails:
    "Please share the areas/corridors you’re considering and the approximate budget for each plot (e.g., highway under 20L, ring road around 30L).",
  offerCallbackWithTime: (state: LeadQualificationState) => {
    const slots = getTimeAwareCallSlots();
    if (state.propertySetup === "different_locations") {
      return `I’ve noted all of that down! 🎯
• Setup: Different Locations
• Goal: ${state.multiPlotPurposes || purposeLabel(state.purpose)}
• Locations: ${state.preferredLocations || "To be confirmed"}
• Budget: ${state.budget || "—"}

To help you look at exact plot availability and multi-plot package pricing, may I arrange a quick call with our Mysuru specialist?

${slots.askLine}`;
    }
    if (state.propertySetup === "side_by_side") {
      return `Excellent selection! I’ve noted your preference for 2 Side-by-Side plots${state.dimensions ? ` (${state.dimensions})` : ""}${state.budget ? ` — Budget: ${state.budget}` : ""}. 🌟

To check exact adjacent plot maps and reserve them together, may I arrange a quick callback with our Mysuru specialist?

${slots.askLine}`;
    }
    return softCallbackAsk(propertySetupLabel(state.propertySetup), slots.askLine);
  },
  answerQueryByStage: (stage?: string, context?: { userMessage?: string; customerName?: string; suggestedProperties?: string[]; propertySetup?: string }) => {
    if (
      stage === "awaiting_callback" ||
      stage === "awaiting_details_confirm" ||
      stage === "awaiting_call_time" ||
      stage === "handed_over" ||
      stage === "awaiting_multi_plot_type" ||
      stage === "awaiting_side_by_side_details" ||
      stage === "awaiting_multi_location_purpose" ||
      stage === "awaiting_multi_location_details"
    ) {
      return answerOutOfBoxQuestion({
        userMessage: context?.userMessage || "",
        customerName: context?.customerName,
        suggestedProperties: context?.suggestedProperties,
        stage,
      });
    }
    switch (stage) {
      case "awaiting_name":
        return "Of course, I can help with that. May I know your name first so I can guide you better?";
      case "awaiting_dimensions":
        return FALLBACK_REPLIES.dimensionsQuestion();
      case "awaiting_budget":
        return "Sure, happy to help. What budget do you have in mind? Just type the approximate amount.";
      default:
        return answerOutOfBoxQuestion({
          userMessage: context?.userMessage || "",
          customerName: context?.customerName,
          suggestedProperties: context?.suggestedProperties,
          stage,
        });
    }
  },
  closing: (property: AllianceProperty | undefined, state: LeadQualificationState) => {
    if (!property) {
      return softCallbackAsk(
        "a Mysuru layout that fits what you shared",
        getTimeAwareCallSlots().askLine,
      );
    }
    return formatFullRecommendation({
      property,
      purpose: state.purpose,
      dimensions: state.dimensions,
    });
  },
  alreadyHandedOver: (name?: string) => {
    const who = name?.trim() ? `, ${name.trim()}` : "";
    return `Welcome back${who}! Your call with our Mysuru specialist is already booked — they’ll reach out at the time we confirmed. 📞

If you’d like to share anything else before the call, just send it here and I’ll make sure they have it.`;
  },
};

export async function generateAllianceSquareFlowReply(input: {
  sessionId: string;
  chatId: string;
  userMessage: string;
}) {
  const conversation = await prisma.aiConversation.upsert({
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
      leadQualification: { stage: "greeting" },
    },
  });

  const previous = (conversation.leadQualification ?? {}) as LeadQualificationState;

  const chat = await prisma.chat.findUnique({
    where: { id: input.chatId },
    include: { contact: true },
  });
  const resolvedPhone =
    previous.phoneNumber ||
    chat?.contact?.phoneNumber ||
    phoneFromExternalId(chat?.externalId) ||
    "";

  // 1) Analyse the customer message
  const analysis = await analyzeCustomerMessage({
    userMessage: input.userMessage,
    previous: { ...previous, phoneNumber: resolvedPhone },
  });

  const decision = decideNextAction(analysis, previous);
  const now = new Date().toISOString();

  const nextState: LeadQualificationState = {
    ...previous,
    stage: decision.nextStage,
    customerName: analysis.customerName || previous.customerName || "",
    intent: analysis.wantsToBuy || previous.intent === "buy" ? "buy" : previous.intent,
    purpose:
      analysis.purpose === "unknown"
        ? previous.purpose || ""
        : analysis.purpose,
    budget: analysis.budget || previous.budget || "",
    dimensions: analysis.dimensions || previous.dimensions || "",
    phoneNumber: resolvedPhone,
    lastAnalysis: analysis.summary,
    updatedAt: now,
  };

  if (decision.action === "investment") {
    nextState.purpose = "investment";
  }
  if (decision.action === "home") {
    nextState.purpose = "home";
  }
  if (decision.action === "hybrid") {
    nextState.purpose = "both";
  }
  if (decision.action === "share_company_details") {
    nextState.purposeExplained = true;
  }
  if (decision.action === "schedule_morning") {
    nextState.preferredCallTime = "morning";
    nextState.chosenCallSlot =
      analysis.chosenCallSlot || previous.chosenCallSlot || "Tomorrow morning";
  }
  if (decision.action === "schedule_evening") {
    nextState.preferredCallTime = "evening";
    nextState.chosenCallSlot =
      analysis.chosenCallSlot || previous.chosenCallSlot || "This evening";
  }
  if (analysis.chosenCallSlot) {
    nextState.chosenCallSlot = analysis.chosenCallSlot;
    if (/morning/i.test(analysis.chosenCallSlot)) nextState.preferredCallTime = "morning";
    else nextState.preferredCallTime = "evening";
  }
  if (analysis.propertySetup) {
    nextState.propertySetup = analysis.propertySetup;
  }
  if (analysis.wantsMultiPlot && !nextState.propertySetup) {
    nextState.propertySetup = nextState.propertySetup || "";
  }
  if (analysis.multiPlotPurposes) {
    nextState.multiPlotPurposes = analysis.multiPlotPurposes;
  } else if (
    decision.action === "ask_multi_location_details" &&
    !nextState.multiPlotPurposes
  ) {
    nextState.multiPlotPurposes = "1 Investment + 1 Build-a-Home";
  }
  if (analysis.preferredLocations) {
    nextState.preferredLocations = analysis.preferredLocations;
  }
  if (decision.action === "greet" && decision.nextStage === "awaiting_name") {
    nextState.purpose = "";
    nextState.budget = "";
    nextState.dimensions = "";
    nextState.customerName = "";
    nextState.suggestedProperties = [];
    nextState.lastSummary = "";
    nextState.purposeExplained = false;
    nextState.preferredCallTime = "";
    nextState.chosenCallSlot = "";
    nextState.propertySetup = "";
    nextState.multiPlotPurposes = "";
    nextState.preferredLocations = "";
  }

  const suggestions = suggestProperties({
    purpose: nextState.purpose,
    budget: nextState.budget,
    dimensions: nextState.dimensions,
    limit: 2,
  });
  // Keep the previously suggested property once chosen (callback/confirm steps).
  if (
    previous.suggestedProperties?.length &&
    [
      "share_details",
      "ask_callback",
      "confirm_lead_details",
      "confirm_callback",
      "ask_call_time",
      "schedule_morning",
      "schedule_evening",
      "defer_callback",
      "correct_details",
      "answer_query",
      "ask_multi_plot_type",
      "ask_side_by_side_details",
      "ask_multi_location_purpose",
      "ask_multi_location_details",
      "offer_callback_with_time",
      "clarify_multi_plot_type",
      "clarify_side_by_side_details",
      "clarify_multi_location_purpose",
      "clarify_multi_location_details",
      "already_closed",
    ].includes(decision.action)
  ) {
    nextState.suggestedProperties = previous.suggestedProperties;
  } else {
    nextState.suggestedProperties = suggestions.map((property) => property.name);
  }

  const primaryProperty =
    findPropertyByName(nextState.suggestedProperties?.[0]) ||
    suggestions[0] ||
    findPropertyByName(previous.suggestedProperties?.[0]);

  // 2) Summarize with Gemini, then 3) generate a dynamic reply (not fixed script)
  const { summary, reply, model } = await summarizeAndReplyWithGemini({
    userMessage: input.userMessage,
    analysis,
    decisionAction: decision.action,
    state: nextState,
    suggestions: primaryProperty ? [primaryProperty, ...suggestions.filter((p) => p.id !== primaryProperty.id)].slice(0, 2) : suggestions,
  });
  nextState.lastSummary = summary;

  const escalate =
    decision.action === "schedule_morning" || decision.action === "schedule_evening";

  logger.info("Analyse → summarize → reply completed", {
    sessionId: input.sessionId,
    chatId: input.chatId,
    analysis: analysis.summary,
    summary,
    action: decision.action,
    nextStage: decision.nextStage,
    model,
    reply: reply.slice(0, 160),
  });

  await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: {
      leadQualification: nextState as Prisma.InputJsonValue,
      escalatedToHuman: escalate || Boolean(conversation.escalatedToHuman),
    },
  });

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
        content: reply,
        model,
      },
    ],
  });

  if (chat?.contactId) {
    await prisma.contact.update({
      where: { id: chat.contactId },
      data: {
        ...(nextState.customerName ? { name: nextState.customerName } : {}),
        leadScore: escalate ? 90 : nextState.purpose ? 60 : nextState.customerName ? 40 : 30,
        customFields: nextState as Prisma.InputJsonValue,
      },
    });
  }

  if (escalate) {
    await createNotification({
      title: "Alliance Square callback confirmed",
      body: "A WhatsApp lead confirmed their details and is ready for executive callback.",
      type: "INFO",
      metadata: {
        sessionId: input.sessionId,
        chatId: input.chatId,
        conversationId: conversation.id,
        customerName: nextState.customerName,
        phoneNumber: nextState.phoneNumber,
        purpose: nextState.purpose,
        budget: nextState.budget,
        dimensions: nextState.dimensions,
        preferredCallTime: nextState.preferredCallTime,
        chosenCallSlot: nextState.chosenCallSlot,
        suggestedProperties: nextState.suggestedProperties,
        summary,
        analysis: analysis.summary,
        action: decision.action,
      },
    });
  }

  // Prefer the warm sales script for key moments; otherwise use dynamic understanding reply.
  const scriptedActions = new Set([
    "greet",
    "ask_name",
    "welcome_named",
    "ask_purpose",
    "clarify_purpose",
    "ask_help",
    "share_company_details",
    "investment",
    "home",
    "hybrid",
    "ask_budget",
    "clarify_budget",
    "ask_dimensions",
    "clarify_dimensions",
    "suggest_and_close",
    "ask_callback",
    "confirm_lead_details",
    "confirm_callback",
    "ask_call_time",
    "schedule_morning",
    "schedule_evening",
    "defer_callback",
    "correct_details",
    "share_details",
    "answer_query",
    "ask_multi_plot_type",
    "ask_side_by_side_details",
    "ask_multi_location_purpose",
    "ask_multi_location_details",
    "offer_callback_with_time",
    "clarify_multi_plot_type",
    "clarify_side_by_side_details",
    "clarify_multi_location_purpose",
    "clarify_multi_location_details",
    "request_advisor",
    "already_closed",
  ]);
  const scriptedReply = fallbackReplyForAction(
    decision.action,
    nextState,
    primaryProperty,
    input.userMessage,
  );
  const outboundReply = scriptedActions.has(decision.action) || decision.action === "already_closed"
    ? scriptedReply
    : reply;

  const choiceButtons =
    decision.action === "answer_query" ||
    decision.action === "share_details" ||
    decision.action === "schedule_morning" ||
    decision.action === "schedule_evening" ||
    decision.action === "defer_callback" ||
    decision.action === "correct_details" ||
    decision.action === "ask_side_by_side_details" ||
    decision.action === "clarify_side_by_side_details" ||
    decision.action === "ask_multi_location_purpose" ||
    decision.action === "clarify_multi_location_purpose" ||
    decision.action === "ask_multi_location_details" ||
    decision.action === "clarify_multi_location_details"
      ? undefined
      : choiceButtonsForAction(decision.action, {
          customerName: nextState.customerName,
          budget: nextState.budget,
          purpose: nextState.purpose,
        });

  return {
    reply: outboundReply,
    replies: [outboundReply],
    choiceButtons: choiceButtons
      ? {
          ...choiceButtons,
          body: outboundReply,
        }
      : undefined,
    conversationId: conversation.id,
    escalated: escalate,
    stage: nextState.stage,
    analysis: analysis.summary,
    summary,
    suggestedProperties: nextState.suggestedProperties,
  };
}

async function summarizeAndReplyWithGemini(input: {
  userMessage: string;
  analysis: MessageAnalysis;
  decisionAction: string;
  state: LeadQualificationState;
  suggestions: AllianceProperty[];
}) {
  const fallbackReply = fallbackReplyForAction(
    input.decisionAction,
    input.state,
    input.suggestions[0],
    input.userMessage,
  );
  const localSummary = input.analysis.summary || "customer message received";

  if (!env.GEMINI_API_KEY?.trim()) {
    logger.warn("GEMINI_API_KEY missing — using fallback reply after local analysis");
    return {
      summary: localSummary,
      reply: fallbackReply,
      model: "local-fallback",
    };
  }

  const propertyContext = input.suggestions
    .map(
      (property) =>
        `${property.name} — ${property.location}. Category: ${property.purpose}. Why: ${property.why} About ${property.availablePlots} plots available.`,
    )
    .join("\n");
  const categoryOverview = buildCategoryOverviewText();

  try {
    // Step 2: summarize
    const summaryResult = await generateChatCompletion({
      provider: "GEMINI",
      temperature: 0.2,
      maxTokens: 80,
      messages: [
        {
          role: "system",
          content:
            "In one short natural sentence, summarize what this WhatsApp customer said for a Mysuru real-estate sales chat. Mention name, intent, purpose, budget, or plot size only if present. Plain text only — no AI phrasing.",
        },
        {
          role: "user",
          content: `Stage: ${input.state.stage}
Known name: ${input.state.customerName || "none"}
Known purpose: ${input.state.purpose || "none"}
Local analysis: ${input.analysis.summary}
Customer message: ${input.userMessage}`,
        },
      ],
    });

    const summary = cleanWhatsAppReply(summaryResult.text, { preserveScript: true }) || localSummary;

    // Step 3: dynamic reply from summary (not a fixed script)
    const replyResult = await generateChatCompletion({
      provider: "GEMINI",
      temperature: 0.55,
      maxTokens: 140,
      messages: [
        {
          role: "system",
          content: `You are an expert sales consultant for Alliance Square Properties, Mysuru (https://www.alliancesquare.com/).
Chat like a warm, energetic human on WhatsApp — never sound like an AI bot.

Personality:
- Warm & professional: say “Great to connect” / “Welcome” — NEVER “Nice to meet you”
- Audience-adaptive: investors get ROI/appreciation only (never 3 BHK, parking, gardens); homebuilders get MUDA, Ring Road, schools, hospitals, gated safety
- Human: vary acknowledgments (“Got it…”, “Understood…”, “I see what you mean…”)
- Numbered menus must end with: *(You can simply reply with 1, 2, 3, or 4)*

Knowledge framing:
- Investment = Wealth Booster — ₹100–₹200/sqft typical year-1 appreciation; ₹500–₹600/sqft in hot phases; 3–4 year wealth multiplier
- Build-a-Home = Family First — construction-ready, MUDA, Ring Road, schools/hospitals
- Hybrid = living + steady appreciation
Category overview:
${categoryOverview}

Flow goals by action/stage:
- greet: welcome; if they already stated intent, acknowledge it then ask name in the SAME message
- welcome_named / ask_purpose: “Great to connect” + purpose menu (Investment / Build Home / Hybrid / Need help)
- share_company_details: Wealth Booster vs Family First vs Hybrid, then ask which feels closer
- investment: ROI pitch (₹100–200 / ₹500–600), then investment budget bands or custom amount
- home: family / MUDA / Ring Road affirm, then free budget
- hybrid: living + growth affirm, then free budget
- ask_dimensions: affirm budget, numbered sizes (investor blurbs = ROI; home blurbs = living)
- suggest_and_close: full recommendation + layout link; contextual callback ask (never bare loop)
- confirm_lead_details: summary without phone; ask if correct
- confirm_callback / ask_call_time / offer_callback_with_time: use TIME-AWARE slots only (after 6pm → tomorrow morning/afternoon; 3–6pm → later evening/tomorrow morning; before 3pm → this afternoon/evening)
- schedule_morning / schedule_evening: warm closing for the chosen slot
- already_closed: if they greet after booking, acknowledge call is already booked — do NOT restart or re-ask name
- answer_query: answer first; never paste their raw message in quotes; never loop “Shall I arrange a callback?”

Rules:
- Never share listing prices or ₹/sqft for specific layouts (ROI pitch ranges above are allowed for investors)
- Never show or ask for the customer’s phone number
- Never say you are an AI/bot
- Never pitch home-building features to pure investment leads
- Keep replies WhatsApp-friendly
- Return plain WhatsApp text only`,
        },
        {
          role: "user",
          content: `Current stage: ${input.state.stage}
Next goal action: ${input.decisionAction}
Customer name: ${input.state.customerName || "unknown"}
Purpose: ${input.state.purpose || "unknown"}
Budget: ${input.state.budget || "unknown"}
Dimensions: ${input.state.dimensions || "unknown"}
Preferred call time: ${input.state.preferredCallTime || "unknown"}
Analysis summary: ${summary}
Suggested properties:
${propertyContext || "UK Square, CNM Apex City, Jeevan Vihar"}
Latest customer message: ${input.userMessage}

${input.decisionAction === "share_details" ? "Share concrete location/highlights/approval/available plots/link, no prices. Then ask to arrange a callback." : ""}
${input.decisionAction === "answer_query" ? `IMPORTANT: Answer the customer's actual question FIRST. Never repeat “Shall I arrange a callback?” alone. Never paste their raw message inside quotes.
Common answers:
- Buying 2/adjacent plots: Yes enthusiastically; ask same layout or different locations.
- Suggest/compare 2 layouts: Give two numbered options with short bullets and links.
- Bank loan/legal: MUDA/DTCP approved layouts; loans from SBI/HDFC/ICICI common.
- Discount: Specialist can discuss package pricing on the call.
- Unknown hyper-specific detail: acknowledge the topic naturally, say specialist will confirm on call.
Then add ONE soft next step using time-aware call slots. Customer message: ${input.userMessage}` : ""}
${input.decisionAction === "share_company_details" ? "Explain Investment vs Build-a-Home vs Hybrid, then ask which feels closer. No prices." : ""}
${input.decisionAction === "investment" ? "ROI pitch (₹100–200 / ₹500–600 per sqft). Then investment budget bands. Never mention 3BHK/parking/gardens." : ""}
${input.decisionAction === "home" ? "Affirm build-a-home with MUDA/Ring Road/schools/hospitals, then ask budget freely." : ""}
${input.decisionAction === "hybrid" ? "Affirm hybrid (living + growth), then ask budget freely." : ""}
${input.decisionAction === "ask_budget" || input.decisionAction === "clarify_budget" ? (input.state.purpose === "investment" ? "Ask investment budget bands or custom amount." : "Ask for budget as free text.") : ""}
${input.decisionAction === "ask_dimensions" || input.decisionAction === "clarify_dimensions" ? "Affirm their budget warmly, then ask preferred plot size with numbered options + reply hint." : ""}
${input.decisionAction === "suggest_and_close" || input.decisionAction === "close" ? "Give FULL recommendation details now (location, why it fits, approval if any, plots left, and the layout website link). End with contextual callback ask + time-aware slots — do not ask ‘more details?’." : ""}
${input.decisionAction === "confirm_lead_details" ? "Show their entered name, plot type, size, budget, suggested layout. Do NOT show phone number. Ask if details are correct." : ""}
${input.decisionAction === "ask_callback" || input.decisionAction === "offer_callback_with_time" ? "Contextual callback ask tied to their requirement + time-aware slots." : ""}
${input.decisionAction === "confirm_callback" || input.decisionAction === "ask_call_time" ? "Confirm specialist will call. Offer ONLY time-aware slots for current Mysuru time. Do NOT show phone number." : ""}
${input.decisionAction === "schedule_morning" || input.decisionAction === "schedule_evening" ? `Confirm their chosen slot (“${input.state.chosenCallSlot || input.state.preferredCallTime || "the selected time"}”), thank them, and close warmly.` : ""}
${input.decisionAction === "already_closed" ? "Their call is already booked. Acknowledge warmly. Do not restart the flow or ask for name again." : ""}
${input.decisionAction === "defer_callback" ? "Acknowledge they don’t want a call right now; invite them to say yes later." : ""}
${input.decisionAction === "correct_details" ? "Ask what detail to correct (name, budget, size, or plot type). Do not ask for phone number." : ""}
${input.decisionAction === "request_advisor" ? "Warmly move to confirming their details before the callback." : ""}
Write the WhatsApp reply now.`,
        },
      ],
    });

    const reply =
      cleanWhatsAppReply(replyResult.text, {
        allowQualificationLanguage: true,
        preserveScript: true,
      }) || fallbackReply;

    return {
      summary,
      reply,
      model: replyResult.model || "gemini",
    };
  } catch (error) {
    logger.warn("Gemini summarize/reply failed; using fallback", {
      error: error instanceof Error ? error.message : error,
    });
    return {
      summary: localSummary,
      reply: fallbackReply,
      model: "local-fallback",
    };
  }
}

function fallbackReplyForAction(
  action: string,
  state: LeadQualificationState,
  property?: AllianceProperty,
  userMessage?: string,
) {
  const propertyName = property?.name ?? "a good Mysuru layout";
  switch (action) {
    case "greet":
    case "ask_name":
      return FALLBACK_REPLIES.greeting(userMessage);
    case "welcome_named":
      return FALLBACK_REPLIES.welcomeNamed(state.customerName || "there");
    case "ask_help":
      return FALLBACK_REPLIES.askHelp;
    case "ask_purpose":
      return FALLBACK_REPLIES.purposeQuestion;
    case "share_company_details":
      return FALLBACK_REPLIES.companyDetails(state.customerName);
    case "answer_query":
      return FALLBACK_REPLIES.answerQueryByStage(state.stage, {
        userMessage,
        customerName: state.customerName,
        suggestedProperties: state.suggestedProperties,
      });
    case "request_advisor":
      return formatLeadSummary(state);
    case "investment":
      return FALLBACK_REPLIES.investmentAffirm(state.customerName);
    case "home":
      return FALLBACK_REPLIES.homeAffirm(state.customerName);
    case "hybrid":
      return FALLBACK_REPLIES.hybridAffirm(state.customerName);
    case "ask_dimensions":
      return FALLBACK_REPLIES.dimensionsQuestion(state.budget, state.purpose);
    case "ask_budget":
      return FALLBACK_REPLIES.budgetQuestion(state.purpose);
    case "ask_other_dimensions":
      return FALLBACK_REPLIES.askOtherDimensions;
    case "ask_other_budget":
      return FALLBACK_REPLIES.askOtherBudget;
    case "suggest_and_close":
    case "close":
      return FALLBACK_REPLIES.closing(property, state);
    case "ask_callback":
      return FALLBACK_REPLIES.askCallback();
    case "confirm_lead_details":
      return formatLeadSummary(state);
    case "confirm_callback":
      return FALLBACK_REPLIES.confirmCallback(state.customerName);
    case "ask_call_time":
      return FALLBACK_REPLIES.askCallTime();
    case "schedule_morning":
    case "schedule_evening":
      return FALLBACK_REPLIES.scheduleClosing(state);
    case "ask_multi_plot_type":
    case "clarify_multi_plot_type":
      return FALLBACK_REPLIES.askMultiPlotType;
    case "ask_side_by_side_details":
      return FALLBACK_REPLIES.askSideBySideDetails;
    case "clarify_side_by_side_details":
      return FALLBACK_REPLIES.clarifySideBySideDetails;
    case "ask_multi_location_purpose":
      return FALLBACK_REPLIES.askMultiLocationPurpose;
    case "clarify_multi_location_purpose":
      return FALLBACK_REPLIES.clarifyMultiLocationPurpose;
    case "ask_multi_location_details":
      return FALLBACK_REPLIES.askMultiLocationDetails;
    case "clarify_multi_location_details":
      return FALLBACK_REPLIES.clarifyMultiLocationDetails;
    case "offer_callback_with_time":
      return FALLBACK_REPLIES.offerCallbackWithTime(state);
    case "defer_callback":
      return FALLBACK_REPLIES.deferCallback;
    case "correct_details":
      return FALLBACK_REPLIES.correctDetails;
    case "share_details":
      return property
        ? formatPropertyDetails(property)
        : `Happy to share more. ${propertyName} is one of our Mysuru layouts.

${softCallbackAsk(propertyName, getTimeAwareCallSlots().askLine)}`;
    case "already_closed":
      return FALLBACK_REPLIES.alreadyHandedOver(state.customerName);
    case "clarify_purpose":
      return FALLBACK_REPLIES.clarifyPurpose;
    case "clarify_name":
      return FALLBACK_REPLIES.clarifyName;
    case "clarify_dimensions":
      return FALLBACK_REPLIES.clarifyDimensions(state.budget, state.purpose);
    case "clarify_budget":
      return FALLBACK_REPLIES.clarifyBudget(state.purpose);
    default:
      return FALLBACK_REPLIES.greeting(userMessage);
  }
}
