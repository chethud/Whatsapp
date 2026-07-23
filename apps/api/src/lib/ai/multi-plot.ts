import { parseBudgetLakhs } from "./parse-budget.js";

export type PropertySetup = "single" | "side_by_side" | "different_locations" | "";

export function wantsMultiplePlots(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (
    /\b(2|two|multiple|more than one|adjacent|side[-\s]?by[-\s]?side)\b/i.test(value) &&
    /\b(plot|plots|site|sites)\b/i.test(value)
  ) {
    return true;
  }
  return /\b(buy|purchase|want|need)\b/i.test(value) && /\b(2|two|both)\b/i.test(value) && /\b(plot|plots)\b/i.test(value);
}

export function parsePropertySetup(text: string): PropertySetup | null {
  const value = text.trim().toLowerCase();
  if (
    /\bside[-\s]?by[-\s]?side\b/.test(value) ||
    /\bsame layout\b/.test(value) ||
    /\badjacent\b/.test(value) ||
    /\bnext to (each other|one another|family)\b/.test(value) ||
    /^(1|1️⃣|a)$/u.test(value)
  ) {
    return "side_by_side";
  }
  if (
    /\bdifferent (location|locations|areas?|corridors?)\b/.test(value) ||
    /\btwo locations\b/.test(value) ||
    /\bseparate\b/.test(value) ||
    /\bdiversif/.test(value) ||
    /^(2|2️⃣|b)$/u.test(value)
  ) {
    return "different_locations";
  }
  return null;
}

export function parseMultiLocationPurposes(text: string): string | null {
  const value = text.trim();
  if (!value) return null;

  const hasInvest = /\binvest/i.test(value);
  const hasHome = /\b(home|build|live|living|residential)\b/i.test(value);
  if (hasInvest && hasHome) {
    return "1 Investment + 1 Build-a-Home";
  }
  if (hasInvest) return "Both Investment-focused";
  if (hasHome) return "Both Build-a-Home focused";
  if (/^(yes|yeah|yep|ok|okay|sure)\b/i.test(value) && /\b(1|one|invest|home|build)\b/i.test(value)) {
    return "1 Investment + 1 Build-a-Home";
  }
  if (value.length > 8 && !/^(yes|no|morning|evening)$/i.test(value)) {
    return value.slice(0, 80);
  }
  return null;
}

export function parseSideBySideDetails(text: string): { budget?: string; dimensions?: string } {
  const parsedLakhs = parseBudgetLakhs(text);
  const budget =
    text.match(/\d+(\.\d+)?\s*(lakh|lac|lakhs|lacs|crore|cr)/i)?.[0] ||
    (parsedLakhs != null ? `${parsedLakhs} lakhs` : undefined);

  const eachSize = text.match(/\b(20|30|40)\s*[x×]\s*(30|40|60)\b/i);
  const twoTimes = text.match(/\b2\s*[x×]\s*(20|30|40)\s*[x×]\s*(30|40|60)\b/i);
  let dimensions: string | undefined;
  if (twoTimes) {
    dimensions = `2x ${twoTimes[1]}x${twoTimes[2]}`;
  } else if (eachSize) {
    const size = `${eachSize[1]}x${eachSize[2]}`;
    dimensions = /\beach\b|\btwo\b|\b2\b/i.test(text) ? `2x ${size}` : size;
  }

  return { budget, dimensions };
}

export function parseMultiLocationDetails(text: string): {
  preferredLocations?: string;
  budget?: string;
} {
  const value = text.trim();
  if (!value) return {};

  const budgetParts = [...value.matchAll(/(\d+(\.\d+)?)\s*(lakh|lac|lakhs|lacs|l)/gi)].map(
    (match) => `${match[1]} Lakhs`,
  );
  const budget =
    budgetParts.length >= 2
      ? budgetParts.join(" + ")
      : budgetParts[0] ||
        (parseBudgetLakhs(value) != null ? `${parseBudgetLakhs(value)} lakhs` : undefined);

  const preferredLocations = value
    .replace(/\d+(\.\d+)?\s*(lakh|lac|lakhs|lacs|crore|cr|l)\b/gi, "")
    .replace(/\b(budget|under|around|about|for|each|plot|plots)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return {
    preferredLocations: preferredLocations || undefined,
    budget,
  };
}

export function propertySetupLabel(setup?: PropertySetup | string) {
  if (setup === "side_by_side") return "Side-by-Side Plots (Same Layout)";
  if (setup === "different_locations") return "Different Locations";
  if (setup === "single") return "Single Plot";
  return "Single Plot";
}

export function softCallbackAsk(requirement: string, askLine?: string) {
  const timeAsk =
    askLine ||
    "Would this afternoon or this evening work best for a quick call?";
  return `Got it, I fully understand your preference for ${requirement}. To make sure we match you with exact plot numbers and special package pricing, may I arrange a quick callback with our Mysuru specialist?

${timeAsk}`;
}

export const MULTI_PLOT_TYPE_OPTIONS = [
  "Side-by-side (same layout)",
  "Different locations",
] as const;
