import { cn } from "@whatsapp/ui";

export { cn };

export function formatDate(value?: string | Date | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
