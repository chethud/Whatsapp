"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  contact?: { name: string; phoneNumber: string } | null;
};

type MessageRecord = {
  id: string;
  content: string | null;
  direction: string;
  sentAt: string;
  type: string;
};

type SessionRecord = { id: string; name: string; status: string };

function formatPhoneDisplay(phone?: string | null) {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  if (!digits || digits.length < 8) {
    return null;
  }
  return digits.length > 10 ? `+${digits}` : digits;
}

function getChatPhone(chat: ChatRecord) {
  const fromContact = formatPhoneDisplay(chat.contact?.phoneNumber);
  if (fromContact) {
    return fromContact;
  }

  if (chat.externalId.endsWith("@c.us")) {
    return formatPhoneDisplay(chat.externalId.split("@")[0]);
  }

  // Sometimes chat.name was stored as the phone display.
  if (chat.name && /^\+?\d[\d\s-]{7,}$/.test(chat.name.trim())) {
    return formatPhoneDisplay(chat.name);
  }

  return null;
}

function getChatDisplayName(chat: ChatRecord) {
  const phone = getChatPhone(chat);
  const contactName = chat.contact?.name?.trim() || "";
  const chatName = chat.name?.trim() || "";

  const looksLikeId = (value: string) =>
    !value || value.includes("@") || /lid/i.test(value) || /^\+?\d[\d\s-]*$/.test(value);

  if (contactName && !looksLikeId(contactName) && contactName !== phone) {
    return contactName;
  }

  if (chatName && !looksLikeId(chatName) && chatName !== phone) {
    return chatName;
  }

  return null;
}

function getChatHeading(chat: ChatRecord) {
  const name = getChatDisplayName(chat);
  const phone = getChatPhone(chat);

  if (name && phone) {
    return `${name} (${phone})`;
  }
  if (phone) {
    return phone;
  }
  if (name) {
    return name;
  }

  return chat.name ?? chat.externalId;
}

function getChatSubheading(chat: ChatRecord) {
  const name = getChatDisplayName(chat);
  const phone = getChatPhone(chat);

  // Heading already includes name + phone when both exist.
  if (name && phone) {
    return chat.type;
  }
  if (phone) {
    return `${phone} · ${chat.type}`;
  }
  if (name) {
    return `${name} · ${chat.type}`;
  }
  return chat.type;
}

export default function ChatsPage() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sessionFilter, setSessionFilter] = useState<string>("");
  const [chatSearch, setChatSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [debouncedMessageSearch, setDebouncedMessageSearch] = useState("");
  const queryClient = useQueryClient();
  const { subscribeSession } = useRealtime();
  const autoSyncedSessions = useRef<Set<string>>(new Set());
  const autoSyncAttempts = useRef<Record<string, number>>({});

  const sessions = useQuery({
    queryKey: ["sessions-for-chats"],
    queryFn: () => api<{ items: SessionRecord[] }>("/sessions?page=1&pageSize=50"),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasConnected = items.some((session) => session.status === "CONNECTED");
      // Keep polling briefly until a session is connected after QR scan.
      return hasConnected ? false : 3000;
    },
  });

  useEffect(() => {
    const items = sessions.data?.items ?? [];
    if (!items.length) {
      return;
    }

    const connected = items.find((session) => session.status === "CONNECTED");
    if (connected && sessionFilter !== connected.id) {
      // Prefer the connected session after QR scan.
      if (!sessionFilter || items.find((session) => session.id === sessionFilter)?.status !== "CONNECTED") {
        setSessionFilter(connected.id);
      }
    } else if (!sessionFilter) {
      setSessionFilter(connected?.id ?? items[0].id);
    }
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
    queryKey: ["chats", sessionFilter, chatSearch],
    enabled: Boolean(sessionFilter),
    refetchInterval: (query) => {
      // While inbox is empty after connect, keep refreshing so post-ready sync appears.
      if (!isSessionConnected) {
        return false;
      }
      const count = query.state.data?.items?.length ?? 0;
      return count === 0 ? 4000 : false;
    },
    queryFn: () =>
      api<{ items: ChatRecord[] }>(
        `/chats?page=1&pageSize=500&sessionId=${sessionFilter}${
          chatSearch ? `&search=${encodeURIComponent(chatSearch)}` : ""
        }`,
      ),
  });

  const selectedChat = chats.data?.items.find((chat) => chat.id === selectedChatId) ?? null;

  useEffect(() => {
    setMessageSearch("");
    setDebouncedMessageSearch("");
  }, [selectedChatId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMessageSearch(messageSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [messageSearch]);

  const messages = useQuery({
    queryKey: ["messages", selectedChatId, debouncedMessageSearch],
    enabled: Boolean(selectedChatId),
    queryFn: () =>
      api<{ items: MessageRecord[] }>(
        `/messages?page=1&pageSize=200&chatId=${selectedChatId}${
          debouncedMessageSearch ? `&search=${encodeURIComponent(debouncedMessageSearch)}` : ""
        }`,
      ),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      api<{
        items: ChatRecord[];
        synced: number;
        totalFromPhone: number;
        messagesSynced: number;
      }>(`/chats/sync/${sessionFilter}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["chats", sessionFilter, chatSearch], {
        items: data.items,
        total: data.items.length,
      });
      if (data.synced > 0) {
        toast.success(`Synced ${data.synced} chats (${data.messagesSynced} messages) from phone`);
      } else {
        toast.message("WhatsApp is still loading chats. Retrying…");
        autoSyncedSessions.current.delete(sessionFilter);
      }
      queryClient.invalidateQueries({ queryKey: ["chats", sessionFilter] });
    },
    onError: (error) => {
      autoSyncedSessions.current.delete(sessionFilter);
      toast.error(error.message);
    },
  });

  // After connect, pull old chats (with retries while Store is still loading).
  useEffect(() => {
    if (!sessionFilter || !isSessionConnected || syncMutation.isPending) {
      return;
    }
    if (chats.isLoading) {
      return;
    }
    if ((chats.data?.items?.length ?? 0) > 0) {
      return;
    }

    const attempts = autoSyncAttempts.current[sessionFilter] ?? 0;
    if (attempts >= 5) {
      return;
    }

    const delay = attempts === 0 ? 1500 : 5000;
    const timer = window.setTimeout(() => {
      autoSyncedSessions.current.add(sessionFilter);
      autoSyncAttempts.current[sessionFilter] = attempts + 1;
      syncMutation.mutate();
    }, delay);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionFilter,
    isSessionConnected,
    chats.data?.items?.length,
    chats.isLoading,
    syncMutation.isPending,
  ]);

  // Reset sync attempts when session disconnects so a fresh QR connect can sync again.
  useEffect(() => {
    if (!isSessionConnected && sessionFilter) {
      autoSyncedSessions.current.delete(sessionFilter);
      delete autoSyncAttempts.current[sessionFilter];
    }
  }, [isSessionConnected, sessionFilter]);

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
        {syncMutation.isPending ? (
          <p className="text-sm text-blue-300">Pulling previous chats from phone…</p>
        ) : null}
        {activeSession && !isSessionConnected ? (
          <p className="text-sm text-amber-400">
            Session is {activeSession.status}. Scan the QR on WhatsApp Sessions before syncing or sending.
          </p>
        ) : null}
      </div>

      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-3">
            <p className="text-sm font-medium">Inbox</p>
            <input
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder="Search chats..."
              className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {(chats.data?.items ?? []).length ? (
              chats.data?.items.map((chat) => (
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
                <p className="font-medium">{getChatHeading(chat)}</p>
                <p className="text-xs text-slate-400">
                  {getChatSubheading(chat)} · {chat.unreadCount} unread · {formatDate(chat.lastMessageAt)}
                </p>
              </button>
              ))
            ) : (
              <p className="px-4 py-6 text-sm text-slate-400">
                {syncMutation.isPending
                  ? "Loading previous chats from your phone…"
                  : chatSearch.trim()
                    ? "No chats match your search."
                    : "No chats yet. Click Sync chats to pull conversations from your phone."}
              </p>
            )}
          </div>
        </div>

        <div className="flex min-h-[70vh] flex-col rounded-2xl border border-slate-800 bg-slate-900">
          {selectedChat ? (
            <>
              <div className="border-b border-slate-800 px-4 py-3">
                <p className="font-medium">{getChatHeading(selectedChat)}</p>
                <p className="text-xs text-slate-400">
                  {getChatPhone(selectedChat)
                    ? `${getChatPhone(selectedChat)} · ${selectedChat.type}`
                    : selectedChat.type}
                </p>
                <input
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="Search in chat history..."
                  className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {[...(messages.data?.items ?? [])].reverse().length ? (
                  [...(messages.data?.items ?? [])].reverse().map((item) => (
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
                  ))
                ) : (
                  <p className="text-center text-sm text-slate-400">
                    {messageSearch.trim() ? "No messages match your search." : "No messages in this chat yet."}
                  </p>
                )}
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
