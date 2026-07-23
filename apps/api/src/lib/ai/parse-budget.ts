/** Parse rough budget in lakhs from free customer text. */
export function parseBudgetLakhs(text?: string): number | null {
  if (!text?.trim()) {
    return null;
  }
  const value = text.trim().toLowerCase();
  const crore = value.match(/(\d+(?:\.\d+)?)\s*(crore|cr)\b/);
  if (crore) {
    return Number(crore[1]) * 100;
  }
  const lakh = value.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|lakhs|lacs|l)\b/);
  if (lakh) {
    return Number(lakh[1]);
  }
  const bare = value.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const n = Number(bare[1]);
    // Treat plain numbers as lakhs for this flow (e.g. 25 → 25 lacs).
    if (n > 0 && n < 1000) {
      return n;
    }
  }
  return null;
}
