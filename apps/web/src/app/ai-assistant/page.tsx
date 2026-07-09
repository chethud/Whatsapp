"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";

type Template = { id: string; name: string; description: string | null; content: string };
type KnowledgeDoc = { id: string; title: string; category: string; updatedAt?: string };
type SessionRecord = { id: string; name: string };
type ChatRecord = { id: string; name: string | null; sessionId: string };

export default function AiAssistantPage() {
  const [prompt, setPrompt] = useState("Qualify this lead and answer their pricing questions.");
  const [reply, setReply] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [chatId, setChatId] = useState("");

  const templates = useQuery({
    queryKey: ["ai-templates"],
    queryFn: () => api<Template[]>("/ai/templates"),
  });
  const knowledge = useQuery({
    queryKey: ["knowledge-base"],
    queryFn: () => api<KnowledgeDoc[]>("/ai/knowledge-base"),
  });
  const sessions = useQuery({
    queryKey: ["sessions-for-ai"],
    queryFn: () => api<{ items: SessionRecord[] }>("/sessions?page=1&pageSize=25"),
  });
  const chats = useQuery({
    queryKey: ["chats-for-ai", sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => api<{ items: ChatRecord[] }>(`/chats?page=1&pageSize=50&sessionId=${sessionId}`),
  });

  useEffect(() => {
    if (!sessionId && sessions.data?.items?.[0]?.id) {
      setSessionId(sessions.data.items[0].id);
    }
  }, [sessionId, sessions.data?.items]);

  useEffect(() => {
    if (!chatId && chats.data?.items?.[0]?.id) {
      setChatId(chats.data.items[0].id);
    }
  }, [chatId, chats.data?.items]);

  const replyMutation = useMutation({
    mutationFn: () =>
      api<{ reply: string }>("/ai/reply", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          chatId,
          prompt,
          provider: "OPENAI",
          temperature: 0.4,
          maxTokens: 500,
        }),
      }),
    onSuccess: (data) => setReply(data.reply),
    onError: (error) => toast.error(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api("/messages", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          chatId,
          content: reply,
          type: "TEXT",
        }),
      }),
    onSuccess: () => toast.success("Reply sent to WhatsApp"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell title="AI Assistant">
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <select
          value={sessionId}
          onChange={(event) => {
            setSessionId(event.target.value);
            setChatId("");
          }}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
        >
          {(sessions.data?.items ?? []).map((session) => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))}
        </select>
        <select
          value={chatId}
          onChange={(event) => setChatId(event.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
        >
          {(chats.data?.items ?? []).map((chat) => (
            <option key={chat.id} value={chat.id}>
              {chat.name ?? chat.id}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold">Generate AI reply</h3>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
          />
          <button
            type="button"
            disabled={!sessionId || !chatId}
            onClick={() => replyMutation.mutate()}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-60"
          >
            Generate response
          </button>
          {!sessionId || !chatId ? (
            <p className="mt-3 text-sm text-amber-300">
              Select a connected session and synced chat before generating AI replies.
            </p>
          ) : null}

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-sm text-slate-400">Assistant reply</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">{reply || "No reply yet."}</p>
            {reply ? (
              <button
                type="button"
                disabled={!sessionId || !chatId || sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
                className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-60"
              >
                {sendMutation.isPending ? "Sending..." : "Send to WhatsApp"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <DataTable
            columns={["Prompt Template", "Description", "Action"]}
            rows={(templates.data ?? []).map((template) => [
              template.name,
              template.description,
              <button
                key={template.id}
                type="button"
                onClick={() => setPrompt(template.content)}
                className="rounded-lg bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
              >
                Use
              </button>,
            ])}
          />
          <DataTable
            columns={["Knowledge Doc", "Category"]}
            rows={(knowledge.data ?? []).map((doc) => [doc.title, doc.category])}
          />
        </div>
      </div>
    </DashboardShell>
  );
}
