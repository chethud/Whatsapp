"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { DashboardShell } from "@/components/dashboard-shell";
import { StatCard } from "@/components/stat-card";
import { api, wakeApi } from "@/lib/api";
import { useRealtime } from "@/lib/socket";

export default function DashboardPage() {
  useRealtime();

  useEffect(() => {
    void wakeApi().catch(() => undefined);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void wakeApi().catch(() => undefined);
      }
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () =>
      api<{
        connectedAccounts: number;
        disconnectedAccounts: number;
        todaysMessages: number;
        sentMessages: number;
        receivedMessages: number;
        aiReplies: number;
        contacts: number;
        unreadMessages: number;
        queueSize: number;
        serverStatus: string;
      }>("/dashboard/stats"),
    refetchInterval: 30_000,
  });

  const cards = [
    ["Connected Accounts", data?.connectedAccounts ?? 0],
    ["Disconnected Accounts", data?.disconnectedAccounts ?? 0],
    ["Today's Messages", data?.todaysMessages ?? 0],
    ["Sent Messages", data?.sentMessages ?? 0],
    ["Received Messages", data?.receivedMessages ?? 0],
    ["AI Replies", data?.aiReplies ?? 0],
    ["Contacts", data?.contacts ?? 0],
    ["Unread Messages", data?.unreadMessages ?? 0],
    ["Queue Size", data?.queueSize ?? 0],
    ["Server Status", data?.serverStatus ?? "loading"],
  ] as const;

  return (
    <DashboardShell title="Dashboard">
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
        {isLoading
          ? "Loading platform health and usage metrics..."
          : "Live operational view across sessions, chats, contacts, and AI usage."}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value]) => (
          <StatCard key={label} label={label} value={value} />
        ))}
      </div>
    </DashboardShell>
  );
}
