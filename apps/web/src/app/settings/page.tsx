"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { api } from "@/lib/api";

type Settings = {
  businessName: string;
  timezone: string;
  aiAutoReplyEnabled: boolean;
  defaultAiProvider: string;
  slackWebhookUrl: string | null;
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });

  const [form, setForm] = useState<Settings>({
    businessName: "Alliance Square",
    timezone: "Asia/Kolkata",
    aiAutoReplyEnabled: true,
    defaultAiProvider: "GEMINI",
    slackWebhookUrl: null,
  });

  useEffect(() => {
    if (data) {
      setForm(data);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api<Settings>("/settings", {
        method: "PATCH",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell title="Settings">
      <div className="max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="grid gap-4">
          <input
            value={form.businessName}
            onChange={(event) => setForm((state) => ({ ...state, businessName: event.target.value }))}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            placeholder="Business name"
          />
          <input
            value={form.timezone}
            onChange={(event) => setForm((state) => ({ ...state, timezone: event.target.value }))}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            placeholder="Timezone"
          />
          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.aiAutoReplyEnabled}
              onChange={(event) => setForm((state) => ({ ...state, aiAutoReplyEnabled: event.target.checked }))}
            />
            Bot auto-reply (full control of incoming WhatsApp chats)
          </label>
          <p className="text-xs text-slate-400">
            When enabled, Alliance Square bot automatically replies to every incoming direct chat and runs the full sales conversation.
          </p>
          <select
            value={form.defaultAiProvider}
            onChange={(event) => setForm((state) => ({ ...state, defaultAiProvider: event.target.value }))}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
          >
            <option value="OPENAI">OpenAI</option>
            <option value="GEMINI">Gemini</option>
            <option value="COMPATIBLE">Compatible API</option>
          </select>
          <input
            value={form.slackWebhookUrl ?? ""}
            onChange={(event) => setForm((state) => ({ ...state, slackWebhookUrl: event.target.value || null }))}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            placeholder="Slack webhook URL (optional)"
          />
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            className="w-fit rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500"
          >
            Save settings
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}
