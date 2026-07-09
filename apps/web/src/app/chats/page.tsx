"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { api } from "@/lib/api";
import { useRealtime } from "@/lib/socket";
import { formatDate } from "@/lib/utils";

type ChatRecord = {
  id: string;
  name: string | null;
  externalId: string;
  type: string;
  unreadCount: number;
  lastMessageAt: string | null;
  sessionId: string;
};

type MessageRecord = {
  id: string;
  content: string | null;
  direction: string;
  sentAt: string;
  type: string;
};

type SessionRecord = { id: string; name: string; status: string };

export default function ChatsPage() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sessionFilter, setSessionFilter] = useState<string>("");
  const queryClient = useQueryClient();
  const { subscribeSession } = useRealtime();

  const sessions = useQuery({
    queryKey: ["sessions-for-chats"],
    queryFn: () => api<{ items: SessionRecord[] }>("/sessions?page=1&pageSize=50"),
  });

  useEffect(() => {
    const items = sessions.data?.items ?? [];
    if (!items.length || sessionFilter) {
      return;
    }

    const connected = items.find((session) => session.status === "CONNECTED");
    setSessionFilter(connected?.id ?? items[0].id);
  }, [sessionFilter, sessions.data?.items]);

  const activeSession =
    sessions.data?.items.find((session) => session.id === sessionFilter) ?? null;
  const isSessionConnected = activeSession?.status === "CONNECTED";

  useEffect(() => {
    if (sessionFilter) {
      subscribeSession(sessionFilter);
    }
  }, [sessionFilter, subscribeSession]);

  const chats = useQuery({
    queryKey: ["chats", sessionFilter],
    enabled: Boolean(sessionFilter),
    queryFn: () => api<{ items: ChatRecord[] }>(`/chats?page=1&pageSize=100&sessionId=${sessionFilter}`),
  });

  const selectedChat = chats.data?.items.find((chat) => chat.id === selectedChatId) ?? null;

  const messages = useQuery({
    queryKey: ["messages", selectedChatId],
    enabled: Boolean(selectedChatId),
    queryFn: () => api<{ items: MessageRecord[] }>(`/messages?page=1&pageSize=100&chatId=${selectedChatId}`),
  });

  const syncMutation = useMutation({
    mutationFn: () => api(`/chats/sync/${sessionFilter}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success("Chats synced");
      queryClient.invalidateQueries({ queryKey: ["chats", sessionFilter] });
    },
    onError: (error) => toast.error(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: () => {
      if (!isSessionConnected) {
        throw new Error("Connect WhatsApp before sending messages");
      }
      return api("/messages", {
        method: "POST",
        body: JSON.stringify({
          sessionId: selectedChat?.sessionId,
          chatId: selectedChat?.id,
          content: message,
          type: "TEXT",
        }),
      });
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["messages", selectedChatId] });
      queryClient.invalidateQueries({ queryKey: ["chats", sessionFilter] });
    },
    onError: (error) => toast.error(error.message),
  });

  const markReadMutation = useMutation({
    mutationFn: (chatId: string) => api(`/chats/${chatId}/mark-read`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chats", sessionFilter] }),
  });

  return (
    <DashboardShell title="Chats">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={sessionFilter}
          onChange={(event) => setSessionFilter(event.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm"
        >
          {(sessions.data?.items ?? []).map((session) => (
            <option key={session.id} value={session.id}>
              {session.name} ({session.status})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!sessionFilter || !isSessionConnected || syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-60"
        >
          Sync chats
        </button>
        {activeSession && !isSessionConnected ? (
          <p className="text-sm text-amber-400">
            Session is {activeSession.status}. Scan the QR on WhatsApp Sessions before syncing or sending.
          </p>
        ) : null}
      </div>

      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium">Inbox</div>
          <div className="max-h-[70vh] overflow-y-auto">
            {(chats.data?.items ?? []).map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  setSelectedChatId(chat.id);
                  if (chat.unreadCount > 0) {
                    markReadMutation.mutate(chat.id);
                  }
                }}
                className={`block w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-800 ${
                  selectedChatId === chat.id ? "bg-slate-800" : ""
                }`}
              >
                <p className="font-medium">{chat.name ?? chat.externalId}</p>
                <p className="text-xs text-slate-400">
                  {chat.type} · {chat.unreadCount} unread · {formatDate(chat.lastMessageAt)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-[70vh] flex-col rounded-2xl border border-slate-800 bg-slate-900">
          {selectedChat ? (
            <>
              <div className="border-b border-slate-800 px-4 py-3">
                <p className="font-medium">{selectedChat.name ?? selectedChat.externalId}</p>
                <p className="text-xs text-slate-400">{selectedChat.externalId}</p>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {[...(messages.data?.items ?? [])].reverse().map((item) => (
                  <div
                    key={item.id}
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                      item.direction === "OUTBOUND"
                        ? "ml-auto bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-100"
                    }`}
                  >
                    <p>{item.content ?? `[${item.type}]`}</p>
                    <p className="mt-1 text-[10px] opacity-70">{formatDate(item.sentAt)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 p-4">
                <div className="flex gap-2">
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && message.trim()) {
                        sendMutation.mutate();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={!message.trim() || !isSessionConnected || sendMutation.isPending}
                    onClick={() => sendMutation.mutate()}
                    className="rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-60"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Select a chat to view the conversation.
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
