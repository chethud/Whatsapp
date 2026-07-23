const LEAD_DATA_REGEX = /\n?---LEAD_DATA---[\s\S]*$/i;
const JSON_FOOTER_REGEX = /\n?\{[\s\S]*"leadScore"[\s\S]*\}$/;
const INTERNAL_DISCLOSURE_REGEX =
  /\b(system prompt|lead[_ ]?data|conversation id|chat id|@lid|internal only|tracking)\b/gi;
// Strip listing-style prices only (keep words like budget in qualification questions).
const PRICE_REGEX =
  /(?:₹|rs\.?|inr)\s?[\d,.]+(?:\s?(?:\/\s?sqft|per\s?sqft| onwards))?|\b\d+[\d,.]*\s?(?:\/\s?sqft|per\s?sqft)\b/gi;

const MAX_REPLY_CHARS = 180;
const MAX_REPLY_SENTENCES = 2;
const MAX_REPLY_WORDS = 35;

export function cleanWhatsAppReply(
  rawText: string,
  options?: { allowQualificationLanguage?: boolean; preserveScript?: boolean },
): string {
  let text = rawText
    .replace(LEAD_DATA_REGEX, "")
    .replace(JSON_FOOTER_REGEX, "")
    .replace(INTERNAL_DISCLOSURE_REGEX, "")
    .replace(PRICE_REGEX, "")
    .trim();

  text = stripMarkdown(text, { keepParagraphs: Boolean(options?.preserveScript) });
  text = options?.preserveScript ? softCollapseWhitespace(text) : collapseWhitespace(text);
  text = stripQuotedCustomerEcho(text);
  // Only strip robotic keyword prompts — keep intentional sales options (1/2/3).
  text = text
    .replace(/\bReply with your choice\.?/gi, "")
    .replace(/\bPlease select( an option)?\.?/gi, "")
    .replace(/\bYou can also say things like\b[^.!\n]*/gi, "")
    .replace(/\bYou can also say\b[^.!\n]*/gi, "")
    .trim();
  text = options?.preserveScript ? softCollapseWhitespace(text) : collapseWhitespace(text);

  // Scripted Alliance Square flow messages must not be truncated.
  if (!options?.preserveScript) {
    text = limitSentences(text, MAX_REPLY_SENTENCES);
    text = limitWords(text, MAX_REPLY_WORDS);
    text = truncateAtWord(text, MAX_REPLY_CHARS);
    text = collapseWhitespace(text);
  }

  if (!text) {
    return `Hi there! Welcome to Alliance Square! 🏡

We’d love to help you find the perfect property. May I know your name?`;
  }

  // Block accidental listing-price disclosures, but allow budget qualification language.
  if (!options?.allowQualificationLanguage && /(?:₹|\/sqft)/i.test(text)) {
    return "Our executive will share pricing on call. Want me to connect you?";
  }

  return text;
}

function stripQuotedCustomerEcho(text: string): string {
  return text
    .replace(/^got your message about\s+"[^"]+"\.?\s*/i, "")
    .replace(/^regarding\s+"[^"]+"\.?\s*/i, "")
    .trim();
}

function stripMarkdown(text: string, options?: { keepParagraphs?: boolean }): string {
  let cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[ \t]+\n/g, "\n");

  // Keep point-wise bullets for scripted sales messages (WhatsApp).
  if (!options?.keepParagraphs) {
    cleaned = cleaned.replace(/^\s*[-*•]\s+/gm, "");
  }

  if (options?.keepParagraphs) {
    return cleaned.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  }

  return cleaned
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s{2,}/g, " ");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function softCollapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function limitSentences(text: string, maxSentences: number): string {
  // Avoid treating honorifics like "sir!" / "madam!" as sentence boundaries.
  const normalized = text.replace(/\b(sir|madam|miss|mrs|mr|ms)!/gi, "$1\u0001");
  const parts = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts || parts.length <= maxSentences) {
    return text;
  }

  return parts
    .slice(0, maxSentences)
    .map((part) => part.replace(/\u0001/g, "!").trim())
    .join(" ")
    .trim();
}

function limitWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }

  return words.slice(0, maxWords).join(" ").replace(/[.,;:!?]+$/, "").trim();
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const shortened = text.slice(0, maxChars);
  const lastSpace = shortened.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.5) {
    return `${shortened.slice(0, lastSpace).trim()}.`;
  }

  return `${shortened.trim()}.`;
}
