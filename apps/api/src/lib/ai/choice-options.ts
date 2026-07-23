/** Soft WhatsApp tap choices for Alliance Square sales flow. */

import { plotSizesAffordableForBudget } from "./alliance-properties.js";
import { MULTI_PLOT_TYPE_OPTIONS } from "./multi-plot.js";
import { getTimeAwareCallSlots } from "./call-time.js";
export { parseBudgetLakhs } from "./parse-budget.js";

export const PLOT_SIZE_OPTIONS = ["20x30", "30x40", "40x60"] as const;
export const BUDGET_OPTIONS = ["20 lacs", "30 lacs", "40 lacs"] as const;
export const INVESTMENT_BUDGET_OPTIONS = [
  "Under ₹20 Lakhs",
  "₹20 Lakhs – ₹35 Lakhs",
  "₹35 Lakhs+",
  "Type custom amount",
] as const;
export const PURPOSE_OPTIONS = ["Investment Plot", "Build a Home", "Hybrid"] as const;
export const PURPOSE_OPTIONS_WITH_HELP = [
  "Investment Property (Wealth Booster)",
  "Build a Home Property (Family First)",
  "Hybrid Option (Living + Growth)",
  "Need help deciding? (Tell me the difference)",
] as const;
export const AFTER_HELP_OPTIONS = [
  "Investment Plot",
  "Build a Home",
  "Hybrid",
  "Speak with advisor",
] as const;
export const OTHER_OPTION = "Other";
export const CALLBACK_CONFIRM_OPTIONS = ["Yes, arrange a call", "Not now"] as const;
export const DETAILS_CONFIRM_OPTIONS = ["Yes, details are correct", "Need to correct"] as const;

export const REPLY_NUMBER_HINT = "\n\n*(You can simply reply with 1, 2, 3, or 4)*";
export const REPLY_NUMBER_HINT_12 = "\n\n*(Reply with 1 or 2)*";

export type ChoiceButtons = {
  body: string;
  buttonOptions: string[];
  options: string[];
};

const PURPOSE_MENU = `To help us guide you best, what are you looking for?

1️⃣ Investment Property (Wealth Booster)
2️⃣ Build a Home Property (Family First)
3️⃣ Hybrid Option (Living + Growth)
4️⃣ Need help deciding? (Tell me the difference)${REPLY_NUMBER_HINT}`;

/** Show plot sizes that fit the budget against the pricing sheet. */
export function plotSizesForBudget(budgetText?: string): string[] {
  return plotSizesAffordableForBudget(budgetText);
}

function sizeBlurb(size: string, purpose?: string) {
  if (purpose === "investment") {
    if (size === "20x30") return "Compact entry — strong % ROI potential";
    if (size === "30x40") return "Popular size for balanced appreciation";
    if (size === "40x60") return "Larger holding for premium corridor plays";
    return "";
  }
  if (size === "20x30") return "Ideal for compact, budget-friendly homes";
  if (size === "30x40") return "The classic choice for spacious family living";
  if (size === "40x60") return "Premium space for a larger family home";
  return "";
}

function formatNumberedSizes(sizes: string[], purpose?: string) {
  const marks = ["1️⃣", "2️⃣", "3️⃣"];
  return sizes
    .map((size, index) => {
      const blurb = sizeBlurb(size, purpose);
      return `${marks[index] ?? `${index + 1}.`} ${size}${blurb ? ` (${blurb})` : ""}`;
    })
    .join("\n");
}

export function choiceButtonsForAction(
  action: string,
  context?: { customerName?: string; budget?: string; purpose?: string },
): ChoiceButtons | undefined {
  const name = context?.customerName?.trim() || "there";
  const callSlots = getTimeAwareCallSlots();

  switch (action) {
    case "welcome_named":
      return {
        body: `Great to connect with you, ${name}! Finding the right property is one of the smartest wealth moves you can make.

${PURPOSE_MENU}`,
        buttonOptions: PURPOSE_OPTIONS_WITH_HELP.slice(0, 3),
        options: [...PURPOSE_OPTIONS_WITH_HELP],
      };
    case "ask_purpose":
    case "clarify_purpose":
    case "ask_help":
      return {
        body: PURPOSE_MENU,
        buttonOptions: PURPOSE_OPTIONS_WITH_HELP.slice(0, 3),
        options: [...PURPOSE_OPTIONS_WITH_HELP],
      };
    case "share_company_details":
      return {
        body: `Glad you asked${name !== "there" ? `, ${name}` : ""}! Choosing the right plot depends on your goals. Here’s a quick breakdown:

📈 Investment Plot (Wealth Booster)
High-growth corridors & industrial belts — strong appreciation over 3–7 years.

🏡 Build a Home Plot (Family First)
Ready-to-build spots near Ring Road, schools, and hospitals.

🔄 Hybrid Option
A site you can build on today that still appreciates steadily.

Which of these sounds closer to what you have in mind today?

1️⃣ Investment Plot
2️⃣ Build a Home
3️⃣ Hybrid
4️⃣ Speak with advisor${REPLY_NUMBER_HINT}`,
        buttonOptions: AFTER_HELP_OPTIONS.slice(0, 3),
        options: [...AFTER_HELP_OPTIONS],
      };
    case "investment":
      return {
        body: `Smart move${name !== "there" ? `, ${name}` : ""}! Land in high-growth corridors is one of the highest-performing assets right now. 📈

In our top investment belts near Mysuru, historical trends show a steady appreciation of ₹100 – ₹200 per sq. ft. even in conservative conditions within 12 months. In high-demand phases, we see surges of ₹500 – ₹600 per sq. ft. Over a 3 to 4-year holding period, it delivers massive ROI potential.

What approximate budget do you have allocated for this investment?

1️⃣ Under ₹20 Lakhs
2️⃣ ₹20 Lakhs – ₹35 Lakhs
3️⃣ ₹35 Lakhs+
4️⃣ Type custom amount

*(You can simply reply with 1, 2, 3, or 4, or type your budget)*`,
        buttonOptions: INVESTMENT_BUDGET_OPTIONS.slice(0, 3),
        options: [...INVESTMENT_BUDGET_OPTIONS],
      };
    case "ask_budget":
    case "clarify_budget":
      if (context?.purpose === "investment") {
        return {
          body: `What approximate budget do you have allocated for this investment?

1️⃣ Under ₹20 Lakhs
2️⃣ ₹20 Lakhs – ₹35 Lakhs
3️⃣ ₹35 Lakhs+
4️⃣ Type custom amount

*(You can simply reply with 1, 2, 3, or 4, or type your budget)*`,
          buttonOptions: INVESTMENT_BUDGET_OPTIONS.slice(0, 3),
          options: [...INVESTMENT_BUDGET_OPTIONS],
        };
      }
      return undefined;
    case "home":
    case "hybrid":
      return undefined;
    case "ask_dimensions":
    case "clarify_dimensions": {
      const sizes = plotSizesForBudget(context?.budget);
      return {
        body: `Based on your budget, which plot size would you prefer?

${formatNumberedSizes(sizes, context?.purpose)}${REPLY_NUMBER_HINT_12.replace("1 or 2", sizes.length >= 3 ? "1, 2, or 3" : "1 or 2")}`,
        buttonOptions: sizes.slice(0, 3),
        options: sizes,
      };
    }
    case "ask_multi_plot_type":
      return {
        body: `Are you looking for two side-by-side plots in the same layout, or plots in different locations?

1️⃣ Side-by-side (same layout)
2️⃣ Different locations

*(Reply with 1 for Same Layout or 2 for Different Locations)*`,
        buttonOptions: [...MULTI_PLOT_TYPE_OPTIONS],
        options: [...MULTI_PLOT_TYPE_OPTIONS],
      };
    case "suggest_and_close":
    case "ask_callback":
      return {
        body: "May I arrange a quick callback?",
        buttonOptions: [...CALLBACK_CONFIRM_OPTIONS],
        options: [...CALLBACK_CONFIRM_OPTIONS],
      };
    case "confirm_lead_details":
      return {
        body: "Are these details correct?",
        buttonOptions: [...DETAILS_CONFIRM_OPTIONS],
        options: [...DETAILS_CONFIRM_OPTIONS],
      };
    case "confirm_callback":
    case "ask_call_time":
    case "offer_callback_with_time":
      return {
        body: callSlots.askLine,
        buttonOptions: [...callSlots.options],
        options: [...callSlots.options],
      };
    default:
      return undefined;
  }
}

export function isOtherChoice(text: string): boolean {
  return /^(other|any\s*other|something\s*else)$/i.test(text.trim());
}

export function isHybridChoice(text: string): boolean {
  const trimmed = text.trim();
  return /\bhybrid\b/i.test(trimmed) ||
    /\b(balanced(\s+option)?|living\s*\+\s*growth|investment\s*(and|&|\+)\s*(home|living|build))\b/i.test(
      trimmed,
    );
}

/** Option 4 / more details / explain the difference. */
export function isHelpDecidingChoice(text: string): boolean {
  const trimmed = text.trim();
  return /^(4|4️⃣)$/u.test(trimmed) ||
    /\b(need help deciding|help deciding|tell me the difference|what('?s| is) the difference|not sure|confused|explain (both|the difference|all))\b/i.test(
      trimmed,
    );
}

export function isAdvisorChoice(text: string): boolean {
  const trimmed = text.trim();
  return /^d$/i.test(trimmed) ||
    /\b(speak with advisor|talk to (an )?advisor|speak to (someone|an advisor|executive)|advisor|call me|call (an )?executive)\b/i.test(
      trimmed,
    );
}

export function isAffirmativeChoice(text: string): boolean {
  const trimmed = text.trim();
  return /^(y|yes|yeah|yep|ok|okay|sure|correct|confirm|confirmed|right|perfect|go ahead|please do|do it)$/iu.test(
    trimmed,
  ) ||
    /\b(yes|yeah|yep|sure|ok(ay)?|correct|confirm(ed)?|go ahead|arrange (a )?call|please (do|arrange)|details are correct|yes,? arrange)\b/i.test(
      trimmed,
    );
}

export function isNegativeChoice(text: string): boolean {
  const trimmed = text.trim();
  if (
    /^(n|no|nope|nah|not now|later|wrong|incorrect|need to correct)$/iu.test(trimmed)
  ) {
    return true;
  }
  return /\b(not now|need to correct|don'?t (call|arrange)|do not (call|arrange)|cancel (the )?call)\b/i.test(
    trimmed,
  );
}

/** @deprecated Prefer resolveChosenSlot from call-time.ts for time-aware slots. */
export function parsePreferredCallTime(text: string): "morning" | "evening" | "" {
  const value = text.trim().toLowerCase();
  if (/\bmorning\b/i.test(value) || /\bforenoon\b/i.test(value)) return "morning";
  if (/\bevening\b/i.test(value) || /\bnight\b/i.test(value) || /\bafternoon\b/i.test(value)) {
    return "evening";
  }
  return "";
}

export function parseInvestmentBudgetChoice(text: string): string | null {
  const key = text.trim().toLowerCase();
  if (key === "1" || key === "1️⃣" || /under\s*₹?\s*20/i.test(key) || /below\s*20/i.test(key)) {
    return "Under ₹20 Lakhs";
  }
  if (key === "2" || key === "2️⃣" || /20\s*(lakh|lac|l).{0,12}35/i.test(key)) {
    return "₹20 Lakhs – ₹35 Lakhs";
  }
  if (key === "3" || key === "3️⃣" || /35\s*(lakh|lac|l|\+)/i.test(key) || /above\s*35/i.test(key)) {
    return "₹35 Lakhs+";
  }
  if (key === "4" || key === "4️⃣" || /custom|other|type/i.test(key)) {
    return null; // ask them to type
  }
  return null;
}
