/**
 * Alliance Square layout catalog (pricing sheet + Investment / Home / Hybrid categorization).
 * Prices are used only for matching budget + plot size — never quote ₹ in WhatsApp.
 */

import { parseBudgetLakhs } from "./parse-budget.js";
import { getTimeAwareCallSlots } from "./call-time.js";
import { softCallbackAsk } from "./multi-plot.js";

const PLOT_SIZE_OPTIONS = ["20x30", "30x40", "40x60"] as const;

export type PropertyPurpose = "investment" | "home" | "both";
export type PlotSizeKey = "20x30" | "30x40" | "40x60";

export type AllianceProperty = {
  id: string;
  name: string;
  type: "layout" | "apartment";
  url: string;
  location: string;
  /** Short WhatsApp-safe selling points (no ₹). */
  highlights: string[];
  /** Category pitch from sales overview — no ₹. */
  why: string;
  purpose: PropertyPurpose;
  /** ₹ per sqft — internal matching only */
  ratePerSqft: number;
  /** Fixed sheet prices for 20x30 (600) and 30x40 (1,200). 40x60 = rate × 2,400 */
  price20x30: number;
  price30x40: number;
  /** Random-ish available plots for chat suggestions (stable for process lifetime). */
  availablePlots: number;
  approval?: string;
};

function randomPlots(min = 4, max = 28) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Categorization:
 * - Investment (Wealth Boosters): Dhatri Square, Adhya Enclave, Jeevan Vihar Phase 2
 * - Build a Home (Family First): CNM Apex City, Dr. Daya Nagar, Alliance Serene Phase 2
 * - Hybrid (balanced): UK Square, Jeevan Vihar, Sridevi Lake View
 */
export const ALLIANCE_PROPERTIES: AllianceProperty[] = [
  {
    id: "dhatri-square",
    name: "Dhatri Square",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/dhatri-square",
    location: "Off Hunsur Road",
    highlights: [
      "Lowest entry cost across listings",
      "Expanding Hunsur Road highway corridor",
      "Strong percentage ROI potential",
    ],
    why: "Lowest entry cost on an expanding Hunsur Road corridor — strong ROI potential over 3–7 years.",
    purpose: "investment",
    ratePerSqft: 1600,
    price20x30: 960_000,
    price30x40: 1_920_000,
    availablePlots: randomPlots(),
    approval: "DTCP",
  },
  {
    id: "adhya-enclave",
    name: "Adhya Enclave",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/adhya-enclave",
    location: "Chamalapura Main Rd, Nanjangud",
    highlights: [
      "Nanjangud industrial belt growth",
      "Manufacturing hub corridor",
      "Capital appreciation focus",
    ],
    why: "On Chamalapura Main Road, Nanjangud — capitalizes on the industrial belt and manufacturing hubs.",
    purpose: "investment",
    ratePerSqft: 3400,
    price20x30: 2_040_000,
    price30x40: 4_080_000,
    availablePlots: randomPlots(),
    approval: "MUDA",
  },
  {
    id: "jeevan-vihar-phase-2",
    name: "Jeevan Vihar Phase 2",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/jeevan-vihar-phase-2",
    location: "Bannur–Kanakapura Highway",
    highlights: [
      "Right on Bannur–Kanakapura Highway",
      "High visibility corridor",
      "Long-term asset growth",
    ],
    why: "Right on the Bannur–Kanakapura Highway — high visibility and expressway frontage for long-term growth.",
    purpose: "investment",
    ratePerSqft: 6499,
    price20x30: 3_899_400,
    price30x40: 7_798_800,
    availablePlots: randomPlots(),
  },
  {
    id: "cnm-apex-city",
    name: "CNM Apex City",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/cnm-apex-city",
    location: "Srirampura Ring Road",
    highlights: [
      "Prime Srirampura Ring Road location",
      "Immediate readiness for living",
      "Near city landmarks",
    ],
    why: "On Srirampura Ring Road — one of Mysuru’s prime residential corridors, ready for family living.",
    purpose: "home",
    ratePerSqft: 5499,
    price20x30: 3_299_400,
    price30x40: 6_598_800,
    availablePlots: randomPlots(),
  },
  {
    id: "dr-daya-nagar",
    name: "Dr. Daya Nagar",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/dr.-daya-nagar",
    location: "Off Bogadi Road",
    highlights: [
      "Established Bogadi family neighborhood",
      "Fully developed MUDA-approved layout",
      "Ready for construction",
    ],
    why: "Off Bogadi Road in a preferred family neighborhood — fully developed MUDA layout ready to build.",
    purpose: "home",
    ratePerSqft: 3500,
    price20x30: 2_100_000,
    price30x40: 4_200_000,
    availablePlots: randomPlots(),
    approval: "MUDA",
  },
  {
    id: "alliance-serene-phase-2",
    name: "Alliance Serene Phase 2",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/alliance-serene-phase-2",
    location: "Off Bannur Road",
    highlights: [
      "About 2 mins from Ring Road",
      "Near schools, hospitals and resorts",
      "Strong home-building location",
    ],
    why: "Just ~2 minutes from Ring Road off Bannur Road — near schools, hospitals, resorts and convention centers.",
    purpose: "home",
    ratePerSqft: 3500,
    price20x30: 2_100_000,
    price30x40: 4_200_000,
    availablePlots: randomPlots(),
  },
  {
    id: "uk-square",
    name: "UK Square",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/uk-square",
    location: "Mysuru–Kushalnagar Hwy Exit",
    highlights: [
      "Highway exit junction connectivity",
      "Gated community living",
      "Balanced investment and home use",
    ],
    why: "At the Mysuru–Kushalnagar Highway Exit — expressway upside with gated community living.",
    purpose: "both",
    ratePerSqft: 3200,
    price20x30: 1_920_000,
    price30x40: 3_840_000,
    availablePlots: randomPlots(),
  },
  {
    id: "jeevan-vihar",
    name: "Jeevan Vihar",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/jeevan-vihar",
    location: "Mysuru",
    highlights: [
      "MUDA-approved",
      "Budget-friendly hybrid option",
      "Immediate registration options",
    ],
    why: "MUDA-approved, budget-friendly hybrid — sites ready for immediate registration and steady appreciation.",
    purpose: "both",
    ratePerSqft: 2500,
    price20x30: 1_500_000,
    price30x40: 3_000_000,
    availablePlots: randomPlots(),
    approval: "MUDA",
  },
  {
    id: "sridevi-lake-view",
    name: "Sridevi Lake View",
    type: "layout",
    url: "https://www.alliancesquare.com/layouts/sridevi-lake-view",
    location: "Off T Narasipura Road",
    highlights: [
      "DTCP-approved",
      "Scenic surroundings",
      "Attractive entry for living or investing",
    ],
    why: "DTCP-approved off T Narasipura Road — scenic surroundings and amenities at an attractive entry point.",
    purpose: "both",
    ratePerSqft: 2400,
    price20x30: 1_440_000,
    price30x40: 2_880_000,
    availablePlots: randomPlots(),
    approval: "DTCP",
  },
];

function normalizeSize(dimensions?: string): PlotSizeKey | null {
  if (!dimensions) {
    return null;
  }
  const n = dimensions.toLowerCase().replace(/\s+/g, "").replace("×", "x");
  if (n.includes("20x30")) return "20x30";
  if (n.includes("30x40")) return "30x40";
  if (n.includes("40x60")) return "40x60";
  return null;
}

/** Internal plot price in ₹ for a size. 40x60 derived from rate × 2400. */
export function plotPriceInr(property: AllianceProperty, size: PlotSizeKey): number {
  if (size === "20x30") return property.price20x30;
  if (size === "30x40") return property.price30x40;
  return property.ratePerSqft * 2400;
}

function budgetInr(budgetText?: string): number | null {
  const lakhs = parseBudgetLakhs(budgetText);
  if (lakhs == null) return null;
  return Math.round(lakhs * 100_000);
}

function purposeLabel(purpose: PropertyPurpose) {
  if (purpose === "investment") return "Investment (Wealth Booster)";
  if (purpose === "home") return "Build a Home (Family First)";
  return "Hybrid (Investment + Living)";
}

/** Plot sizes that have at least one layout within budget. */
export function plotSizesAffordableForBudget(budgetText?: string): string[] {
  const budget = budgetInr(budgetText);
  if (budget == null) {
    return [...PLOT_SIZE_OPTIONS];
  }
  const affordable = PLOT_SIZE_OPTIONS.filter((size) =>
    ALLIANCE_PROPERTIES.some((property) => plotPriceInr(property, size) <= budget * 1.05),
  );
  return affordable.length ? [...affordable] : ["20x30"];
}

export function suggestProperties(input: {
  purpose?: "investment" | "home" | "both" | "";
  budget?: string;
  dimensions?: string;
  limit?: number;
}): AllianceProperty[] {
  const limit = input.limit ?? 2;
  const purpose = input.purpose || "";
  const size = normalizeSize(input.dimensions);
  const budget = budgetInr(input.budget);

  const scored = ALLIANCE_PROPERTIES.map((property) => {
    let score = 0;
    const price = size ? plotPriceInr(property, size) : property.price30x40;

    // Strong category match: dedicated investment/home first, hybrids as balanced fallbacks.
    if (purpose === "investment") {
      if (property.purpose === "investment") score += 8;
      else if (property.purpose === "both") score += 4;
      else score -= 4;
    } else if (purpose === "home") {
      if (property.purpose === "home") score += 8;
      else if (property.purpose === "both") score += 4;
      else score -= 4;
    } else if (purpose === "both") {
      if (property.purpose === "both") score += 8;
      else score += 2;
    } else {
      score += 1;
    }

    if (budget != null) {
      if (price <= budget) {
        const unused = (budget - price) / budget;
        score += 8 - unused * 4;
      } else if (price <= budget * 1.08) {
        score += 2;
      } else {
        score -= 6;
      }
    }

    if (size) {
      score += 2;
    }

    score += Math.min(property.availablePlots, 20) / 40;

    return { property, score, price };
  }).sort((a, b) => b.score - a.score);

  const underBudget =
    budget != null ? scored.filter((item) => item.price <= budget * 1.08) : scored;
  const pool = underBudget.length ? underBudget : scored;

  return pool.slice(0, limit).map((item) => item.property);
}

export function formatPropertySuggestion(properties: AllianceProperty[]) {
  if (!properties.length) {
    return "We have approved Mysuru layouts that can fit your need.";
  }
  if (properties.length === 1) {
    const [property] = properties;
    return `I’d suggest ${property.name} (${shortLocation(property.location)}) — ${property.availablePlots} plots available right now.`;
  }
  const [first, second] = properties;
  return `I’d suggest ${first.name} near ${shortLocation(first.location)} (${first.availablePlots} plots left), or ${second.name} near ${shortLocation(second.location)} (${second.availablePlots} plots left).`;
}

export function findPropertyByName(name?: string): AllianceProperty | undefined {
  if (!name?.trim()) {
    return undefined;
  }
  const needle = name.trim().toLowerCase();
  return ALLIANCE_PROPERTIES.find((property) => property.name.toLowerCase() === needle);
}

/** Short WhatsApp-friendly details — never include listing prices. */
export function formatPropertyDetails(property: AllianceProperty) {
  const slots = getTimeAwareCallSlots();
  const lines = [
    `Here are the key highlights for *${property.name}*:`,
    `• *Location:* ${property.location}. ${property.why}`,
    property.approval
      ? `• *Approvals:* ${property.approval}-approved with clean titles, ready for construction and bank loans.`
      : `• *Approvals:* Approved layout with clear documentation.`,
    `• *Availability:* Only ${property.availablePlots} plots left in this range!`,
    `• More info: ${property.url}`,
    "",
    softCallbackAsk(property.name, slots.askLine),
  ];
  return lines.join("\n");
}

/** Full recommendation after plot size — details first, then offer a call (no “more details?” fork). */
export function formatFullRecommendation(input: {
  property: AllianceProperty;
  purpose?: "investment" | "home" | "both" | "";
  dimensions?: string;
}) {
  const { property, purpose, dimensions } = input;
  const slots = getTimeAwareCallSlots();

  let sizeNote = "Great selection!";
  if (dimensions) {
    if (purpose === "investment") {
      sizeNote = dimensions.includes("20x30")
        ? "A 20x30 plot is a compact entry point with strong percentage ROI potential."
        : dimensions.includes("30x40")
          ? "A 30x40 plot is a popular size for balanced appreciation in growth corridors."
          : dimensions.includes("40x60")
            ? "A 40x60 plot gives you a larger holding for premium corridor plays."
            : `Great choice on the ${dimensions} size for investment.`;
    } else {
      sizeNote = dimensions.includes("20x30")
        ? "A 20x30 plot is ideal for a compact, budget-friendly home."
        : dimensions.includes("30x40")
          ? "A 30x40 plot gives you ample space for a spacious family home."
          : dimensions.includes("40x60")
            ? "A 40x60 plot gives you generous space for a premium family home."
            : `Great choice on the ${dimensions} size.`;
    }
  }

  const fit =
    purpose === "home"
      ? "a wonderful family-home fit"
      : purpose === "both"
        ? "a balanced fit for living and long-term appreciation"
        : "a strong fit for investment growth";

  const points = [
    ...property.highlights.slice(0, 3),
    property.approval ? `${property.approval}-Approved & ready to move forward` : null,
    `High Demand: Only ${property.availablePlots} plots left in this range!`,
  ].filter(Boolean) as string[];

  const emoji = purpose === "investment" ? "📈" : "🏡";

  return `Excellent selection! ${sizeNote} ${emoji}

Based on your budget and goals, I highly recommend ${property.name} (${property.location}) — ${fit}:

${points.map((point) => `• ${point}`).join("\n")}
• Layout link: ${property.url}

To share exact plot numbers and package pricing with you, may I arrange a quick call with our Mysuru specialist?

${slots.askLine}`;
}

function shortLocation(location: string) {
  return location
    .replace(/, Mysuru$/i, "")
    .replace(/^Off\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

export function buildPropertiesKnowledgeText() {
  return ALLIANCE_PROPERTIES.map((property) => {
    const approval = property.approval ? ` Approval: ${property.approval}.` : "";
    return `${property.name} — ${purposeLabel(property.purpose)}. ${property.location}. Why: ${property.why}${approval} About ${property.availablePlots} plots available. More: ${property.url}`;
  }).join("\n");
}

/** Category overview for help-deciding / Gemini context (no ₹). */
export function buildCategoryOverviewText() {
  const byPurpose = (purpose: PropertyPurpose) =>
    ALLIANCE_PROPERTIES.filter((property) => property.purpose === purpose)
      .map((property) => `${property.name} (${property.location})`)
      .join("; ");

  return `Investment Plots / Wealth Boosters (3–7 year appreciation, highways, industrial corridors): ${byPurpose("investment")}.
Build a Home / Family First (ready to build, ring road, schools, hospitals): ${byPurpose("home")}.
Hybrid (balanced living + appreciation): ${byPurpose("both")}.`;
}
