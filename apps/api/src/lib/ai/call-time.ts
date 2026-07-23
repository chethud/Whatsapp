/** Mysuru (IST) time-aware callback slot helpers. */

export type CallTimeSlot = {
  options: [string, string];
  askLine: string;
  contextNote: string;
};

function mysuruHour(): number {
  const hourPart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  })
    .formatToParts(new Date())
    .find((part) => part.type === "hour")?.value;
  return Number(hourPart ?? 12);
}

/** Pick realistic callback slots from current Mysuru local time. */
export function getTimeAwareCallSlots(): CallTimeSlot {
  const hour = mysuruHour();

  // After 6:00 PM
  if (hour >= 18) {
    return {
      options: ["Tomorrow morning", "Tomorrow afternoon"],
      askLine:
        "Since it's late evening now, would tomorrow morning or tomorrow afternoon work best for you?",
      contextNote: "late evening",
    };
  }

  // Between 3:00 PM and 6:00 PM
  if (hour >= 15) {
    return {
      options: ["Later this evening", "Tomorrow morning"],
      askLine:
        "Would later this evening or tomorrow morning work best for a quick call?",
      contextNote: "late afternoon",
    };
  }

  // Before 3:00 PM
  return {
    options: ["This afternoon", "This evening"],
    askLine: "Would this afternoon or this evening work best for a quick call?",
    contextNote: "daytime",
  };
}

export function parseCallTimeChoice(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;

  if (/^(1|1️⃣|a)$/u.test(value)) return "slot_1";
  if (/^(2|2️⃣|b)$/u.test(value)) return "slot_2";

  if (/\btomorrow\s+morning\b/.test(value) || /\bmorning\b/.test(value)) {
    return "morning";
  }
  if (/\btomorrow\s+afternoon\b/.test(value) || /\bafternoon\b/.test(value)) {
    return "afternoon";
  }
  if (/\blater\s+this\s+evening\b/.test(value) || /\bthis\s+evening\b/.test(value) || /\bevening\b/.test(value)) {
    return "evening";
  }
  if (/\bthis\s+afternoon\b/.test(value)) {
    return "afternoon";
  }
  return null;
}

export function resolveChosenSlot(text: string, slots: CallTimeSlot): string | null {
  const key = text.trim().toLowerCase();
  if (/^(1|1️⃣|a)$/u.test(key)) return slots.options[0];
  if (/^(2|2️⃣|b)$/u.test(key)) return slots.options[1];

  const parsed = parseCallTimeChoice(text);
  if (!parsed) return null;

  const match = slots.options.find((option) => option.toLowerCase().includes(parsed));
  if (match) return match;

  // Map generic morning/evening/afternoon onto the offered pair.
  if (parsed === "morning") {
    return slots.options.find((option) => /morning/i.test(option)) || slots.options[0];
  }
  if (parsed === "evening") {
    return slots.options.find((option) => /evening/i.test(option)) || slots.options[1];
  }
  if (parsed === "afternoon") {
    return slots.options.find((option) => /afternoon/i.test(option)) || slots.options[0];
  }
  return null;
}

export function scheduleClosingMessage(input: {
  name?: string;
  chosenSlot: string;
  propertySetup?: string;
  layout?: string;
}) {
  const who = input.name?.trim() || "there";
  const focus =
    input.propertySetup && input.propertySetup !== "Single Plot"
      ? input.propertySetup
      : input.layout || "your selected options";

  if (/morning/i.test(input.chosenSlot)) {
    return `Got it, ${input.chosenSlot.toLowerCase()} it is! 🌅 I’ve scheduled our Mysuru specialist to give you a call then with all the details and map options for ${focus}.

Thank you for connecting with Alliance Square, ${who} — have a wonderful day ahead! 🏡✨`;
  }

  if (/evening/i.test(input.chosenSlot)) {
    return `Nice, ${input.chosenSlot.toLowerCase()} it is! 🌆 I’ve passed all your preferences over to our Mysuru specialist. They will call you then to walk you through layout maps.

Thank you for connecting with Alliance Square, ${who} — have a wonderful evening ahead! 🏡✨`;
  }

  return `Perfect, ${input.chosenSlot.toLowerCase()} it is! I’ve scheduled our Mysuru specialist to call you then with the details for ${focus}.

Thank you for connecting with Alliance Square, ${who} — looking forward to helping you! 🏡✨`;
}
