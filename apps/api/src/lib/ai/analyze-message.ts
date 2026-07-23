import { generateChatCompletion } from "./provider.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

import { PLOT_SIZE_OPTIONS, BUDGET_OPTIONS, isOtherChoice, isHelpDecidingChoice, isAdvisorChoice, isHybridChoice, isAffirmativeChoice, isNegativeChoice, parsePreferredCallTime, plotSizesForBudget, parseBudgetLakhs, parseInvestmentBudgetChoice } from "./choice-options.js";
import { looksLikeCustomQuestion, detectOutOfBoxTopic } from "./out-of-box-replies.js";
import {
  wantsMultiplePlots,
  parsePropertySetup,
  parseMultiLocationPurposes,
  parseSideBySideDetails,
  parseMultiLocationDetails,
  type PropertySetup,
} from "./multi-plot.js";
import { getTimeAwareCallSlots, resolveChosenSlot } from "./call-time.js";

type FlowStage =
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

type PreviousState = {
  stage?: FlowStage;
  purpose?: "investment" | "home" | "both" | "";
  customerName?: string;
  dimensions?: string;
  budget?: string;
  purposeExplained?: boolean;
  phoneNumber?: string;
  preferredCallTime?: "morning" | "evening" | "";
  chosenCallSlot?: string;
  propertySetup?: PropertySetup;
  multiPlotPurposes?: string;
  preferredLocations?: string;
};

export type MessageAnalysis = {
  isGreeting: boolean;
  wantsToBuy: boolean;
  wantsMoreDetails: boolean;
  wantsOther: boolean;
  wantsAdvisor: boolean;
  isQuestion: boolean;
  isAffirmative: boolean;
  isNegative: boolean;
  wantsMultiPlot: boolean;
  insistentMultiPlot: boolean;
  propertySetup: PropertySetup;
  multiPlotPurposes: string;
  preferredLocations: string;
  preferredCallTime: "morning" | "evening" | "";
  chosenCallSlot: string;
  purpose: "investment" | "home" | "both" | "unknown";
  hasName: boolean;
  customerName: string;
  hasDimensions: boolean;
  hasBudget: boolean;
  hasBudgetOrDimensions: boolean;
  hasSideBySideDetails: boolean;
  hasMultiLocationDetails: boolean;
  budget: string;
  dimensions: string;
  summary: string;
  confidence: number;
};

const GREETING_RE =
  /^(hi+|hii+|hello+|hell+o+|hey+|start(ing)?|good\s*(morning|afternoon|evening)|namaste|hola|is\s+anyone\s+(there|here)\??|anyone\s+(there|here)\??)[\s!?.]*$/i;
const BUY_INTENT_RE =
  /\b(buy|buying|purchase|looking for|want|need|interested|property|plot|site|layout|apartment|flat)\b/i;
const INVESTMENT_RE = /\b(invest|investment|investing|resale|appreciation|returns?)\b/i;
const HOME_RE =
  /\b(home|house|build|building|reside|residential|live|living|own stay|self use|make a home|to make a home)\b/i;
const DIMENSION_RE =
  /(\d{2,3}\s*[x×\-]\s*\d{2,3})|(\d{2,3}\s*\/\s*\d{2,3}(?:\s*\/\s*\d{2,3})?)|\b(20x30|30x40|40x60|30x50|20x40|40x40)\b/i;
const BUDGET_RE =
  /\b(\d+(\.\d+)?\s*(lakh|lac|lakhs|lacs|crore|cr))\b|\b(20|30|40)\s*(lacs?|lakhs?)?\b/i;
const MORE_DETAILS_RE =
  /\b(more\s+details?|need\s+(more\s+)?details?|tell\s+me\s+more|share\s+(more\s+)?details?|details?\s+please|more\s+info|more\s+information)\b/i;
const QUESTION_RE =
  /\?|\b(what|how|why|where|when|which|who|tell\s+me|explain|about|info|information|price|cost|location|project|layout|company|business|difference|meaning|mean)\b/i;

/**
 * Step 1: Analyse the customer's message before any reply is sent.
 */
export async function analyzeCustomerMessage(input: {
  userMessage: string;
  previous: PreviousState;
}): Promise<MessageAnalysis> {
  const local = analyzeLocally(input.userMessage, input.previous);

  if (!env.GEMINI_API_KEY) {
    logger.info("Message analysed locally (no Gemini key)", {
      summary: local.summary,
      purpose: local.purpose,
      hasName: local.hasName,
    });
    return local;
  }

  try {
    const ai = await analyzeWithGemini(input.userMessage, input.previous, local);
    logger.info("Message analysed with Gemini", {
      summary: ai.summary,
      purpose: ai.purpose,
      hasName: ai.hasName,
      confidence: ai.confidence,
    });
    return ai;
  } catch (error) {
    logger.warn("Gemini analysis failed; using local analysis", {
      error: error instanceof Error ? error.message : error,
    });
    return local;
  }
}

function extractCustomerName(text: string): string {
  const cleaned = text
    .replace(/^(my name is|i am|i'm|im|this is|myself|name[:\s-]+)\s*/i, "")
    .replace(/[.!?,]+$/g, "")
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 40) {
    return "";
  }
  if (GREETING_RE.test(cleaned) || BUY_INTENT_RE.test(cleaned) || INVESTMENT_RE.test(cleaned) || HOME_RE.test(cleaned)) {
    return "";
  }
  if (DIMENSION_RE.test(cleaned) || BUDGET_RE.test(cleaned) || /\d/.test(cleaned)) {
    return "";
  }
  if (!/^[a-zA-Z][a-zA-Z\s.'.-]{0,39}$/.test(cleaned)) {
    return "";
  }
  if (cleaned.split(/\s+/).filter(Boolean).length > 4) {
    return "";
  }

  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function analyzeLocally(userMessage: string, previous: PreviousState): MessageAnalysis {
  let text = userMessage.trim();

  // Map quick replies from buttons / A-B-C / 1-2-3-4 choices.
  if (/^[1-4abcd]$/i.test(text) || /^[1️⃣2️⃣3️⃣4️⃣]$/u.test(text)) {
    const key = text.trim().toLowerCase();
    if (previous.stage === "awaiting_callback") {
      if (key === "1" || key === "1️⃣" || key === "a") text = "Yes, arrange a call";
      else if (key === "2" || key === "2️⃣" || key === "b") text = "Not now";
    } else if (previous.stage === "awaiting_details_confirm") {
      if (key === "1" || key === "1️⃣" || key === "a") text = "Yes, details are correct";
      else if (key === "2" || key === "2️⃣" || key === "b") text = "Need to correct";
    } else if (previous.stage === "awaiting_call_time") {
      const slots = getTimeAwareCallSlots();
      if (key === "1" || key === "1️⃣" || key === "a") text = slots.options[0];
      else if (key === "2" || key === "2️⃣" || key === "b") text = slots.options[1];
    } else if (previous.stage === "awaiting_budget") {
      if (key === "1" || key === "1️⃣") text = "Under ₹20 Lakhs";
      else if (key === "2" || key === "2️⃣") text = "₹20 Lakhs – ₹35 Lakhs";
      else if (key === "3" || key === "3️⃣") text = "₹35 Lakhs+";
      else if (key === "4" || key === "4️⃣") text = "Type custom amount";
    } else if (previous.stage === "awaiting_multi_plot_type") {
      if (key === "1" || key === "1️⃣" || key === "a") text = "Side-by-side same layout";
      else if (key === "2" || key === "2️⃣" || key === "b") text = "Different locations";
    } else if (previous.stage === "awaiting_dimensions") {
      const options = plotSizesForBudget(previous.budget);
      const index =
        key === "1" || key === "1️⃣" ? 0 : key === "2" || key === "2️⃣" ? 1 : key === "3" || key === "3️⃣" ? 2 : -1;
      if (index >= 0) text = options[index] ?? text;
    } else if (previous.stage === "awaiting_purpose" || previous.stage === "awaiting_intent") {
      if (key === "1" || key === "1️⃣" || key === "a") text = "Investment";
      else if (key === "2" || key === "2️⃣" || key === "b") text = "Build a home";
      else if (key === "3" || key === "3️⃣" || key === "c") text = "Hybrid";
      else if (key === "4" || key === "4️⃣" || key === "d") {
        text = previous.purposeExplained ? "Speak with advisor" : "Need help deciding";
      }
    }
  }

  // Accept dash or spaced sizes like 20-30 / 30 40.
  const normalizedSize = text.match(/\b(20|30|40)\s*[x×\-\s]\s*(30|40|60)\b/i);
  if (normalizedSize) {
    text = `${normalizedSize[1]}x${normalizedSize[2]}`;
  }

  const isGreeting = GREETING_RE.test(text);
  const wantsOther = isOtherChoice(text);
  const wantsAdvisor = isAdvisorChoice(text);
  const wantsHelpDeciding = isHelpDecidingChoice(text) || MORE_DETAILS_RE.test(text);
  const wantsToBuy = BUY_INTENT_RE.test(text);
  const wantsMoreDetails = wantsHelpDeciding;
  const isAffirmative = isAffirmativeChoice(text);
  const isNegative = isNegativeChoice(text) && !isAffirmative;
  const preferredCallTime = parsePreferredCallTime(text) || "";
  const callSlots = getTimeAwareCallSlots();
  const chosenCallSlot = resolveChosenSlot(text, callSlots) || "";
  const investmentBudgetChoice = parseInvestmentBudgetChoice(text);
  const wantsMultiPlot = wantsMultiplePlots(text) || detectOutOfBoxTopic(text) === "multi_plot";
  const insistentMultiPlot =
    wantsMultiPlot &&
    /\b(if not|won'?t buy|will not buy|before we go ahead|need to know)\b/i.test(text);
  const propertySetup = parsePropertySetup(text) || "";
  const multiPlotPurposes = parseMultiLocationPurposes(text) || "";
  const sideBySide = parseSideBySideDetails(text);
  const multiLocation = parseMultiLocationDetails(text);
  const preferredLocations = multiLocation.preferredLocations || "";
  const purpose: MessageAnalysis["purpose"] =
    wantsOther || wantsHelpDeciding || wantsAdvisor
      ? "unknown"
      : isHybridChoice(text)
        ? "both"
        : INVESTMENT_RE.test(text) && !HOME_RE.test(text)
          ? "investment"
          : HOME_RE.test(text) || /\bbuild a home\b/i.test(text)
            ? "home"
            : "unknown";
  const isQuestion =
    ((/\?/.test(text) || QUESTION_RE.test(text) || looksLikeCustomQuestion(text)) &&
      !wantsOther &&
      !wantsHelpDeciding &&
      !wantsAdvisor &&
      !isAffirmative &&
      !isNegative &&
      !preferredCallTime &&
      !chosenCallSlot &&
      !propertySetup &&
      !(DIMENSION_RE.test(text) && previous.stage === "awaiting_dimensions") &&
      !(BUDGET_RE.test(text) && previous.stage === "awaiting_budget") &&
      (purpose === "unknown" ||
        previous.stage === "awaiting_callback" ||
        previous.stage === "awaiting_details_confirm" ||
        previous.stage === "awaiting_call_time" ||
        previous.stage === "handed_over" ||
        previous.stage === "awaiting_multi_plot_type" ||
        previous.stage === "awaiting_side_by_side_details" ||
        previous.stage === "awaiting_multi_location_purpose" ||
        previous.stage === "awaiting_multi_location_details"));

  const dimensionMatch =
    text.match(/\d{2,3}\s*[x×\-]\s*\d{2,3}/i)?.[0]?.replace(/[×\-]/g, "x").replace(/\s+/g, "") ||
    text.match(/\d{2,3}\s*\/\s*\d{2,3}(?:\s*\/\s*\d{2,3})?/i)?.[0] ||
    "";

  const parsedLakhs = parseBudgetLakhs(text);
  const budgetMatch =
    text.match(/\d+(\.\d+)?\s*(lakh|lac|lakhs|lacs|crore|cr)/i)?.[0] ||
    (parsedLakhs != null ? `${parsedLakhs} lacs` : "") ||
    "";

  const hasExplicitDimension = DIMENSION_RE.test(text) || Boolean(dimensionMatch);
  const hasExplicitBudget =
    BUDGET_RE.test(text) ||
    parsedLakhs != null ||
    /\b(lakh|lac|lakhs|lacs|crore|cr)\b/i.test(text);

  let hasDimensions = hasExplicitDimension;
  let hasBudget = hasExplicitBudget;

  if (previous.stage === "awaiting_dimensions" && !hasDimensions) {
    const looseSize = text.match(/\b(\d{2})\s+(\d{2})\b/);
    if (looseSize) {
      hasDimensions = true;
    }
  }

  // While waiting for budget, accept free-form amounts the customer types.
  if (previous.stage === "awaiting_budget" && !hasBudget) {
    if (parsedLakhs != null || /\b\d{2,4}\b/.test(text)) {
      hasBudget = true;
    }
  }

  let dimensions = sideBySide.dimensions || dimensionMatch;
  if (!dimensions && previous.stage === "awaiting_dimensions") {
    const looseSize = text.match(/\b(\d{2})\s*[x×\/\-\s]\s*(\d{2})\b/i);
    if (looseSize) {
      dimensions = `${looseSize[1]}x${looseSize[2]}`;
      hasDimensions = true;
    }
  }

  let budget = sideBySide.budget || multiLocation.budget || budgetMatch;
  if (investmentBudgetChoice) {
    budget = investmentBudgetChoice;
    hasBudget = true;
  }
  if (previous.stage === "awaiting_budget" || previous.stage === "awaiting_side_by_side_details") {
    if (parsedLakhs != null) {
      budget = `${parsedLakhs} lakhs`;
      hasBudget = true;
    } else if (!budget) {
      const amount = text.match(/\b(\d{2,4}(?:\.\d+)?)\b/)?.[1];
      if (amount) {
        budget = `${amount} lakhs`;
        hasBudget = true;
      }
    }
  }
  if (/type custom amount/i.test(text) && previous.stage === "awaiting_budget") {
    hasBudget = false;
    budget = "";
  }

  if (sideBySide.dimensions) hasDimensions = true;
  if (sideBySide.budget || multiLocation.budget) hasBudget = true;

  const hasSideBySideDetails =
    previous.stage === "awaiting_side_by_side_details" &&
    (Boolean(budget) || Boolean(dimensions) || hasBudget || hasDimensions);
  const hasMultiLocationDetails =
    previous.stage === "awaiting_multi_location_details" &&
    (Boolean(preferredLocations) || Boolean(budget) || valueHasCorridorHint(text));

  let customerName = "";
  let hasName = false;
  if (previous.stage === "awaiting_name" || (!previous.customerName && !isGreeting)) {
    customerName = extractCustomerName(text);
    hasName = Boolean(customerName);
  }
  if (previous.stage === "awaiting_name" && !hasName && !isGreeting && !wantsToBuy && purpose === "unknown") {
    customerName = extractCustomerName(text) || (text.length <= 40 && !/\d/.test(text) ? text : "");
    hasName = Boolean(customerName);
  }

  let summary = "general message";
  if (isGreeting) summary = "customer greeted";
  else if (wantsAdvisor) summary = "customer wants to speak with an advisor";
  else if (wantsMultiPlot) summary = "customer wants multiple plots";
  else if (propertySetup === "side_by_side") summary = "customer wants side-by-side plots";
  else if (propertySetup === "different_locations") summary = "customer wants plots in different locations";
  else if (isQuestion) summary = "customer asked a question";
  else if (wantsOther) summary = "customer chose Other / custom option";
  else if (wantsHelpDeciding) summary = "customer needs help deciding investment vs home vs hybrid";
  else if (hasName) summary = `customer shared name: ${customerName}`;
  else if (purpose === "investment") summary = "customer wants investment property";
  else if (purpose === "home") summary = "customer wants property to build a home";
  else if (purpose === "both") summary = "customer wants a hybrid plot for living and investment";
  else if (isAffirmative) summary = "customer confirmed yes";
  else if (isNegative) summary = "customer said no / wants correction";
  else if (preferredCallTime === "morning" || /morning/i.test(chosenCallSlot)) summary = "customer prefers morning callback";
  else if (preferredCallTime === "evening" || /evening|afternoon/i.test(chosenCallSlot)) summary = "customer prefers evening/afternoon callback";
  else if (wantsToBuy) summary = "customer wants to buy property";
  else if (hasDimensions) summary = "customer shared plot dimensions";
  else if (hasBudget) summary = "customer shared budget";

  return {
    isGreeting,
    wantsToBuy,
    wantsMoreDetails,
    wantsOther,
    wantsAdvisor,
    isQuestion,
    isAffirmative,
    isNegative,
    wantsMultiPlot,
    insistentMultiPlot,
    propertySetup,
    multiPlotPurposes,
    preferredLocations,
    preferredCallTime,
    chosenCallSlot,
    purpose,
    hasName,
    customerName,
    hasDimensions: wantsOther ? false : hasDimensions,
    hasBudget: wantsOther ? false : hasBudget,
    hasBudgetOrDimensions: wantsOther ? false : hasDimensions || hasBudget,
    hasSideBySideDetails,
    hasMultiLocationDetails,
    budget: wantsOther ? "" : String(budget).trim(),
    dimensions: wantsOther ? "" : String(dimensions).trim(),
    summary,
    confidence: 0.7,
  };
}

function valueHasCorridorHint(text: string) {
  return /\b(highway|ring road|hunsur|bannur|bogadi|nanjangud|srirampura|kushalnagar|mysuru|mysore|area|corridor|location|near)\b/i.test(
    text,
  );
}

async function analyzeWithGemini(
  userMessage: string,
  previous: PreviousState,
  fallback: MessageAnalysis,
): Promise<MessageAnalysis> {
  const result = await generateChatCompletion({
    provider: "GEMINI",
    temperature: 0.1,
    maxTokens: 180,
    messages: [
      {
        role: "system",
        content: `You analyse WhatsApp messages for Alliance Square real estate (Mysuru).
Return ONLY valid JSON with this shape:
{"isGreeting":boolean,"wantsToBuy":boolean,"wantsMoreDetails":boolean,"wantsOther":boolean,"wantsAdvisor":boolean,"isQuestion":boolean,"isAffirmative":boolean,"isNegative":boolean,"preferredCallTime":"morning"|"evening"|"","purpose":"investment"|"home"|"both"|"unknown","hasName":boolean,"customerName":"string","hasDimensions":boolean,"hasBudget":boolean,"budget":"string","dimensions":"string","summary":"string","confidence":0to1}
Rules:
- Extract person name when customer introduces themselves
- wantsMoreDetails=true if they need help deciding / want the difference explained / choose option 4
- wantsAdvisor=true if they want to speak with an advisor/executive
- isAffirmative=true for yes / confirm / arrange call / details are correct
- isNegative=true for no / not now / need to correct
- preferredCallTime=morning or evening when they pick a callback time
- isQuestion=true if they ask about the company, meaning of options, locations, process, etc.
- wantsOther=true if they choose Other / custom / something else
- purpose=investment if purchase is for investment/returns
- purpose=home if purchase is to build/live in a house
- purpose=both if they choose Hybrid / balanced living + investment
- dimensions like "30x40"; budget like "20 lacs"
- Do not invent values`,
      },
      {
        role: "user",
        content: `Current stage: ${previous.stage ?? "greeting"}
Previous name: ${previous.customerName || "none"}
Previous purpose: ${previous.purpose || "none"}
Customer message: ${userMessage}`,
      },
    ],
  });

  const parsed = extractJson(result.text);
  if (!parsed) {
    return fallback;
  }

  const purpose =
    parsed.purpose === "investment" || parsed.purpose === "home" || parsed.purpose === "both"
      ? parsed.purpose
      : "unknown";
  const customerName = String(parsed.customerName || fallback.customerName || "").trim();
  const hasName = Boolean(parsed.hasName) || Boolean(customerName) || fallback.hasName;

  return {
    isGreeting: Boolean(parsed.isGreeting) || fallback.isGreeting,
    wantsToBuy: Boolean(parsed.wantsToBuy) || fallback.wantsToBuy,
    wantsMoreDetails: Boolean(parsed.wantsMoreDetails) || fallback.wantsMoreDetails,
    wantsOther: Boolean(parsed.wantsOther) || fallback.wantsOther,
    wantsAdvisor: Boolean(parsed.wantsAdvisor) || fallback.wantsAdvisor,
    isQuestion: Boolean(parsed.isQuestion) || fallback.isQuestion,
    isAffirmative: Boolean(parsed.isAffirmative) || fallback.isAffirmative,
    isNegative: Boolean(parsed.isNegative) || fallback.isNegative,
    wantsMultiPlot: fallback.wantsMultiPlot,
    insistentMultiPlot: fallback.insistentMultiPlot,
    propertySetup: fallback.propertySetup,
    multiPlotPurposes: fallback.multiPlotPurposes || String(parsed.summary || "").includes("investment") && String(parsed.summary || "").includes("home")
      ? fallback.multiPlotPurposes
      : fallback.multiPlotPurposes,
    preferredLocations: fallback.preferredLocations,
    preferredCallTime:
      parsed.preferredCallTime === "morning" || parsed.preferredCallTime === "evening"
        ? parsed.preferredCallTime
        : fallback.preferredCallTime,
    chosenCallSlot: fallback.chosenCallSlot,
    purpose: purpose === "unknown" ? fallback.purpose : purpose,
    hasName,
    customerName: customerName || fallback.customerName,
    hasDimensions: Boolean(parsed.hasDimensions) || fallback.hasDimensions,
    hasBudget: Boolean(parsed.hasBudget) || fallback.hasBudget,
    hasBudgetOrDimensions:
      Boolean(parsed.hasDimensions) ||
      Boolean(parsed.hasBudget) ||
      fallback.hasBudgetOrDimensions,
    hasSideBySideDetails: fallback.hasSideBySideDetails,
    hasMultiLocationDetails: fallback.hasMultiLocationDetails,
    budget: String(parsed.budget || fallback.budget || "").trim(),
    dimensions: String(parsed.dimensions || fallback.dimensions || "").trim(),
    summary: String(parsed.summary || fallback.summary),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.8)),
  };
}

function extractJson(text: string): Partial<MessageAnalysis> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]) as Partial<MessageAnalysis>;
  } catch {
    return null;
  }
}

/**
 * Step 2: Decide the next flow action from analysis + previous stage.
 */
export function decideNextAction(
  analysis: MessageAnalysis,
  previous: PreviousState,
): {
  action:
    | "greet"
    | "ask_name"
    | "welcome_named"
    | "ask_help"
    | "ask_purpose"
    | "ask_dimensions"
    | "ask_budget"
    | "investment"
    | "home"
    | "hybrid"
    | "suggest_and_close"
    | "ask_callback"
    | "confirm_lead_details"
    | "confirm_callback"
    | "ask_call_time"
    | "schedule_morning"
    | "schedule_evening"
    | "defer_callback"
    | "correct_details"
    | "share_details"
    | "share_company_details"
    | "answer_query"
    | "request_advisor"
    | "ask_other_dimensions"
    | "ask_other_budget"
    | "ask_multi_plot_type"
    | "ask_side_by_side_details"
    | "ask_multi_location_purpose"
    | "ask_multi_location_details"
    | "offer_callback_with_time"
    | "close"
    | "already_closed"
    | "clarify_purpose"
    | "clarify_name"
    | "clarify_dimensions"
    | "clarify_budget"
    | "clarify_multi_plot_type"
    | "clarify_side_by_side_details"
    | "clarify_multi_location_purpose"
    | "clarify_multi_location_details";
  nextStage: FlowStage;
} {
  const stage = previous.stage ?? "greeting";

  // After callback is booked: greetings must NOT restart the flow.
  if (stage === "handed_over") {
    if (analysis.isGreeting) {
      return { action: "already_closed", nextStage: "handed_over" };
    }
    if (analysis.wantsMoreDetails) {
      return { action: "share_details", nextStage: "handed_over" };
    }
    if (analysis.isQuestion || analysis.wantsMultiPlot) {
      return { action: "answer_query", nextStage: "handed_over" };
    }
    return { action: "already_closed", nextStage: "handed_over" };
  }

  // Fresh greeting restarts the sales flow (except post-close, handled above).
  if (analysis.isGreeting && stage !== "greeting" && stage !== "awaiting_name") {
    return { action: "greet", nextStage: "awaiting_name" };
  }

  // Multi-plot branching
  if (stage === "awaiting_multi_plot_type") {
    if (analysis.propertySetup === "side_by_side") {
      return { action: "ask_side_by_side_details", nextStage: "awaiting_side_by_side_details" };
    }
    if (analysis.propertySetup === "different_locations") {
      return { action: "ask_multi_location_purpose", nextStage: "awaiting_multi_location_purpose" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_multi_plot_type" };
    }
    return { action: "clarify_multi_plot_type", nextStage: "awaiting_multi_plot_type" };
  }

  if (stage === "awaiting_side_by_side_details") {
    if (analysis.hasSideBySideDetails || analysis.hasBudget || analysis.hasDimensions) {
      return { action: "offer_callback_with_time", nextStage: "awaiting_call_time" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_side_by_side_details" };
    }
    return { action: "clarify_side_by_side_details", nextStage: "awaiting_side_by_side_details" };
  }

  if (stage === "awaiting_multi_location_purpose") {
    if (analysis.multiPlotPurposes || (analysis.isAffirmative && /invest|home|build/i.test(analysis.summary))) {
      return { action: "ask_multi_location_details", nextStage: "awaiting_multi_location_details" };
    }
    // Affirmative to "1 invest + 1 home?" prompt
    if (analysis.isAffirmative) {
      return { action: "ask_multi_location_details", nextStage: "awaiting_multi_location_details" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_multi_location_purpose" };
    }
    return { action: "clarify_multi_location_purpose", nextStage: "awaiting_multi_location_purpose" };
  }

  if (stage === "awaiting_multi_location_details") {
    if (analysis.hasMultiLocationDetails || analysis.hasBudget || analysis.preferredLocations) {
      return { action: "offer_callback_with_time", nextStage: "awaiting_call_time" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_multi_location_details" };
    }
    return { action: "clarify_multi_location_details", nextStage: "awaiting_multi_location_details" };
  }

  if (stage === "awaiting_callback") {
    if (analysis.chosenCallSlot || analysis.preferredCallTime === "morning" || analysis.preferredCallTime === "evening") {
      const morning =
        /morning/i.test(analysis.chosenCallSlot || "") || analysis.preferredCallTime === "morning";
      return {
        action: morning ? "schedule_morning" : "schedule_evening",
        nextStage: "handed_over",
      };
    }
    if (analysis.insistentMultiPlot) {
      return { action: "answer_query", nextStage: "awaiting_call_time" };
    }
    if (analysis.propertySetup === "side_by_side") {
      return { action: "ask_side_by_side_details", nextStage: "awaiting_side_by_side_details" };
    }
    if (analysis.propertySetup === "different_locations") {
      return { action: "ask_multi_location_purpose", nextStage: "awaiting_multi_location_purpose" };
    }
    if (analysis.wantsMultiPlot) {
      return { action: "ask_multi_plot_type", nextStage: "awaiting_multi_plot_type" };
    }
    if (analysis.isAffirmative || analysis.wantsAdvisor) {
      return { action: "confirm_lead_details", nextStage: "awaiting_details_confirm" };
    }
    if (analysis.isNegative) {
      return { action: "defer_callback", nextStage: "awaiting_callback" };
    }
    if (analysis.wantsMoreDetails) {
      return { action: "share_details", nextStage: "awaiting_callback" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_callback" };
    }
    return { action: "ask_callback", nextStage: "awaiting_callback" };
  }

  if (stage === "awaiting_details_confirm") {
    if (analysis.isAffirmative) {
      return { action: "confirm_callback", nextStage: "awaiting_call_time" };
    }
    if (analysis.isNegative) {
      return { action: "correct_details", nextStage: "awaiting_details_confirm" };
    }
    if (analysis.wantsMultiPlot) {
      return { action: "ask_multi_plot_type", nextStage: "awaiting_multi_plot_type" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_details_confirm" };
    }
    return { action: "confirm_lead_details", nextStage: "awaiting_details_confirm" };
  }

  if (stage === "awaiting_call_time") {
    if (analysis.chosenCallSlot || analysis.preferredCallTime === "morning" || analysis.preferredCallTime === "evening") {
      const morning =
        /morning/i.test(analysis.chosenCallSlot || "") || analysis.preferredCallTime === "morning";
      return {
        action: morning ? "schedule_morning" : "schedule_evening",
        nextStage: "handed_over",
      };
    }
    if (analysis.isQuestion || analysis.wantsMultiPlot) {
      return { action: "answer_query", nextStage: "awaiting_call_time" };
    }
    return { action: "ask_call_time", nextStage: "awaiting_call_time" };
  }

  if (stage === "greeting" || !previous.stage) {
    if (analysis.hasName) {
      return { action: "welcome_named", nextStage: "awaiting_purpose" };
    }
    return { action: "greet", nextStage: "awaiting_name" };
  }

  if (stage === "awaiting_name") {
    if (analysis.hasName) {
      return { action: "welcome_named", nextStage: "awaiting_purpose" };
    }
    if (analysis.isGreeting) {
      return { action: "greet", nextStage: "awaiting_name" };
    }
    if (analysis.isQuestion) {
      return { action: "answer_query", nextStage: "awaiting_name" };
    }
    return { action: "clarify_name", nextStage: "awaiting_name" };
  }

  if (stage === "awaiting_intent" || stage === "awaiting_purpose") {
    if (analysis.wantsAdvisor) {
      return { action: "confirm_lead_details", nextStage: "awaiting_details_confirm" };
    }
    if (analysis.wantsMoreDetails) {
      return { action: "share_company_details", nextStage: "awaiting_purpose" };
    }
    if (analysis.propertySetup === "side_by_side" || analysis.propertySetup === "different_locations") {
      return analysis.propertySetup === "side_by_side"
        ? { action: "ask_side_by_side_details", nextStage: "awaiting_side_by_side_details" }
        : { action: "ask_multi_location_purpose", nextStage: "awaiting_multi_location_purpose" };
    }
    if (analysis.wantsMultiPlot) {
      return { action: "ask_multi_plot_type", nextStage: "awaiting_multi_plot_type" };
    }
    if (analysis.purpose === "investment" || analysis.purpose === "home" || analysis.purpose === "both") {
      return {
        action:
          analysis.purpose === "investment"
            ? "investment"
            : analysis.purpose === "home"
              ? "home"
              : "hybrid",
        nextStage: "awaiting_budget",
      };
    }
    if (analysis.isQuestion || analysis.wantsToBuy) {
      return { action: "answer_query", nextStage: "awaiting_purpose" };
    }
    return { action: "ask_purpose", nextStage: "awaiting_purpose" };
  }

  if (stage === "awaiting_budget") {
    if (analysis.wantsAdvisor) {
      return { action: "confirm_lead_details", nextStage: "awaiting_details_confirm" };
    }
    if (analysis.wantsMultiPlot) {
      return { action: "ask_multi_plot_type", nextStage: "awaiting_multi_plot_type" };
    }
    if (analysis.hasBudget) {
      return { action: "ask_dimensions", nextStage: "awaiting_dimensions" };
    }
    if (analysis.isQuestion || analysis.wantsMoreDetails) {
      return { action: "answer_query", nextStage: "awaiting_budget" };
    }
    return { action: "clarify_budget", nextStage: "awaiting_budget" };
  }

  if (stage === "awaiting_dimensions") {
    if (analysis.wantsAdvisor) {
      return { action: "confirm_lead_details", nextStage: "awaiting_details_confirm" };
    }
    if (analysis.wantsMultiPlot) {
      return { action: "ask_multi_plot_type", nextStage: "awaiting_multi_plot_type" };
    }
    if (analysis.wantsOther) {
      return { action: "ask_other_dimensions", nextStage: "awaiting_dimensions" };
    }
    if (analysis.hasDimensions) {
      return { action: "suggest_and_close", nextStage: "awaiting_callback" };
    }
    if (analysis.isQuestion || analysis.wantsMoreDetails) {
      return { action: "answer_query", nextStage: "awaiting_dimensions" };
    }
    return { action: "clarify_dimensions", nextStage: "awaiting_dimensions" };
  }

  return { action: "answer_query", nextStage: "awaiting_purpose" };
}
