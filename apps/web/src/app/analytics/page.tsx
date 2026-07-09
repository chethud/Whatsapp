"use client";

import { useQuery } from "@tanstack/react-query";

import { DashboardShell } from "@/components/dashboard-shell";
import { StatCard } from "@/components/stat-card";
import { api } from "@/lib/api";

type AnalyticsData = {
  messageTrend: Array<{
    date: string;
    label: string;
    inbound: number;
    outbound: number;
    total: number;
  }>;
  sessionsByStatus: Array<{ status: string; count: number }>;
  topChats: Array<{ chatId: string; name: string; messages: number }>;
  totals: { inbound: number; outbound: number };
};

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api<AnalyticsData>("/dashboard/analytics"),
    refetchInterval: 60_000,
  });

  const maxMessages = Math.max(...(data?.messageTrend.map((day) => day.total) ?? [1]), 1);

  return (
    <DashboardShell title="Analytics">
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
        {isLoading
          ? "Loading analytics..."
          : "Message volume, session health, and top conversations over the last 7 days."}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard label="Inbound (7d)" value={data?.totals.inbound ?? 0} />
        <StatCard label="Outbound (7d)" value={data?.totals.outbound ?? 0} />
        <StatCard
          label="Total (7d)"
          value={(data?.totals.inbound ?? 0) + (data?.totals.outbound ?? 0)}
        />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold">Messages per day</h3>
          <div className="mt-6 flex h-56 items-end gap-3">
            {(data?.messageTrend ?? []).map((day) => (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-40 w-full items-end gap-1">
                  <div
                    className="flex-1 rounded-t bg-emerald-500/80"
                    style={{ height: `${(day.inbound / maxMessages) * 100}%`, minHeight: day.inbound ? 4 : 0 }}
                    title={`Inbound: ${day.inbound}`}
                  />
                  <div
                    className="flex-1 rounded-t bg-blue-500/80"
                    style={{ height: `${(day.outbound / maxMessages) * 100}%`, minHeight: day.outbound ? 4 : 0 }}
                    title={`Outbound: ${day.outbound}`}
                  />
                </div>
                <span className="text-xs text-slate-400">{day.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-emerald-500/80" /> Inbound
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-blue-500/80" /> Outbound
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold">Sessions by status</h3>
          <div className="mt-4 space-y-3">
            {(data?.sessionsByStatus ?? []).map((row) => (
              <div key={row.status} className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3">
                <span className="text-sm text-slate-300">{row.status}</span>
                <span className="font-medium">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-lg font-semibold">Top chats (7 days)</h3>
        <div className="mt-4 space-y-3">
          {(data?.topChats ?? []).length ? (
            data?.topChats.map((chat) => (
              <div
                key={chat.chatId}
                className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3"
              >
                <span className="truncate text-sm text-slate-300">{chat.name}</span>
                <span className="text-sm font-medium text-blue-300">{chat.messages} msgs</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No messages yet. Connect WhatsApp and sync chats.</p>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
