import { ALLIANCE_PROPERTIES, type AllianceProperty } from "./alliance-properties.js";
import { getTimeAwareCallSlots } from "./call-time.js";

export type OutOfBoxTopic =
  | "multi_plot"
  | "compare_layouts"
  | "bank_loan"
  | "discount"
  | "unknown";

export function detectOutOfBoxTopic(text: string): OutOfBoxTopic | null {
  const value = text.trim();
  if (!value) return null;

  if (
    /\b(2|two|multiple|more than one|adjacent|side[-\s]?by[-\s]?side|next to each other)\b/i.test(value) &&
    /\b(plot|plots|site|sites)\b/i.test(value)
  ) {
    return "multi_plot";
  }
  if (
    /\b(buy|purchase)\b/i.test(value) &&
    /\b(2|two|both)\b/i.test(value) &&
    /\b(plot|plots)\b/i.test(value)
  ) {
    return "multi_plot";
  }
  if (
    /\b(suggest|compare|comparison|vs|versus|difference between|two layouts|2 layouts|another layout|other layouts?)\b/i.test(
      value,
    )
  ) {
    return "compare_layouts";
  }
  if (/\b(bank|loan|sbi|hdfc|icici|finance|emi|legal|muda|clearance|title)\b/i.test(value)) {
    return "bank_loan";
  }
  if (/\b(discount|bargain|negotiate|cheaper|reduce|best price|lower price|offer)\b/i.test(value)) {
    return "discount";
  }
  return null;
}

/** True when the customer is asking something new (not a plain yes/no flow tap). */
export function looksLikeCustomQuestion(text: string): boolean {
  const value = text.trim();
  if (!value || value.length < 3) return false;
  if (
    /^(y|yes|yeah|yep|ok|okay|sure|no|nope|not now|morning|evening|tomorrow morning|tomorrow afternoon|this afternoon|this evening|later this evening)$/i.test(
      value,
    )
  ) {
    return false;
  }
  if (detectOutOfBoxTopic(value)) return true;
  if (/\?/.test(value)) return true;
  if (/^(can|could|would|should|is|are|do|does|did|will|what|how|why|where|when|which|who|tell|explain|suggest|need to know|i need|before we)\b/i.test(value)) {
    return true;
  }
  return value.split(/\s+/).length >= 4;
}

function pickCompareLayouts(preferred?: string[]): AllianceProperty[] {
  const byName = (name: string) =>
    ALLIANCE_PROPERTIES.find((property) => property.name.toLowerCase() === name.toLowerCase());

  const first =
    (preferred?.[0] && byName(preferred[0])) ||
    byName("Jeevan Vihar") ||
    ALLIANCE_PROPERTIES.find((property) => property.purpose === "both");
  const second =
    (preferred?.[1] && byName(preferred[1])) ||
    byName("Dhatri Square") ||
    ALLIANCE_PROPERTIES.find((property) => property.id !== first?.id);

  return [first, second].filter(Boolean) as AllianceProperty[];
}

function extractCoreSubject(message: string): string {
  const cleaned = message
    .replace(/[?!.,]+/g, " ")
    .replace(/\b(can|could|would|should|please|tell|me|about|know|need|to|the|a|an|i|we|you|u|before|go|ahead)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "that";
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return words.length > 40 ? `${words.slice(0, 37)}…` : words;
}

export function answerOutOfBoxQuestion(input: {
  userMessage: string;
  customerName?: string;
  suggestedProperties?: string[];
  stage?: string;
}): string {
  const name = input.customerName?.trim() || "";
  const who = name ? `, ${name}` : "";
  const topic = detectOutOfBoxTopic(input.userMessage) || "unknown";
  const layout = input.suggestedProperties?.[0] || "your preferred layout";
  const slots = getTimeAwareCallSlots();

  if (topic === "multi_plot") {
    const insistent = /\b(if not|won'?t buy|will not buy|before we go ahead|need to know)\b/i.test(
      input.userMessage,
    );
    if (insistent) {
      return `I completely understand${who}! Yes, you can 100% buy 2 plots—we frequently help buyers acquire adjacent or multi-location plots, and we can reserve both together for you. 🤝

I’ve updated your preference for 2 plots. ${slots.askLine}`;
    }
    if (/\bside[-\s]?by[-\s]?side\b/i.test(input.userMessage)) {
      return `Yes, absolutely! 🏡🏡 Side-by-side plots are a fantastic option if you want extra space for a larger home, private garden, or building next to family.

What total budget or plot dimensions do you have in mind for both plots together?`;
    }
    if (/\bdifferent (location|locations|areas?)\b/i.test(input.userMessage)) {
      return `Understood! Diversifying across two different locations is a smart way to balance immediate family needs with high long-term appreciation. 📈🏡

To help us narrow down the best options: Are you looking for 1 Investment plot + 1 Build-a-Home plot, or something else?`;
    }
    return `Yes, absolutely! 🏡🏡 Buying two plots is a fantastic strategy for long-term wealth and flexibility.

Are you looking for two side-by-side plots in the same layout, or plots in different locations?

*(Reply with 1 for Same Layout or 2 for Different Locations)*`;
  }

  if (topic === "compare_layouts") {
    const [a, b] = pickCompareLayouts(input.suggestedProperties);
    const lineA = a
      ? `1️⃣ ${a.name} (${a.location}): ${a.highlights[0] || a.why}`
      : "1️⃣ Jeevan Vihar (Mysuru): Excellent hybrid plot, MUDA-approved, prime growth zone.";
    const lineB = b
      ? `2️⃣ ${b.name} (${b.location}): ${b.highlights[0] || b.why}`
      : "2️⃣ Dhatri Square: Great residential focus with quick access to schools and hospitals.";
    const linkA = a?.url ? `\n• ${a.name}: ${a.url}` : "";
    const linkB = b?.url ? `\n• ${b.name}: ${b.url}` : "";

    return `Definitely! Here are two top-performing layouts right now:

${lineA}
${lineB}
${linkA}${linkB}

Would you like a quick breakdown of both here, or should our specialist call you with layout maps?

*(You can simply reply with 1 or 2)*`;
  }

  if (topic === "bank_loan") {
    return `Great question${who}! Our layouts are approved (MUDA/DTCP as applicable) with clear documentation, and buyers commonly get loans from major banks like SBI, HDFC and ICICI.

Understood! To help you explore exact loan-ready paperwork for ${layout}, may I arrange a quick callback with our Mysuru specialist?

${slots.askLine}`;
  }

  if (topic === "discount") {
    return `I hear you${who}! Our specialist can definitely discuss custom package pricing—especially for multiple plot purchases—during your call.

Got it — since package pricing depends on exact plot selection, ${slots.askLine}`;
  }

  const subject = extractCoreSubject(input.userMessage);
  return `That's a great question${who}! To make sure we give you accurate information about ${subject}, our Mysuru specialist can confirm the exact detail on your call.

${slots.askLine}`;
}
