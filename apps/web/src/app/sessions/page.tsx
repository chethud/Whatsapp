"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { wsEventNames } from "@whatsapp/shared";

import { DashboardShell } from "@/components/dashboard-shell";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";
import { getSocket, useRealtime } from "@/lib/socket";
import { useAppStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";

type SessionRecord = {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: string;
  lastSeenAt: string | null;
  heartbeatAt: string | null;
  autoReconnect: boolean;
  createdAt: string;
  updatedAt: string;
};

type SessionDetail = SessionRecord & {
  qrDataUrl: string | null;
};

function formatSessionStatus(session: SessionRecord) {
  const ageMs = Date.now() - new Date(session.updatedAt).getTime();

  switch (session.status) {
    case "PENDING":
      return ageMs > 45_000 ? "Still starting — click Refresh QR if needed" : "Starting browser…";
    case "QR_READY":
      return "Ready to scan";
    case "CONNECTED":
      return "Connected";
    case "DISCONNECTED":
      return "Disconnected";
    case "AUTH_FAILURE":
      return "Auth failed";
    case "LOGGED_OUT":
      return "Logged out";
    default:
      return session.status;
  }
}

function statusClassName(status: string, updatedAt: string) {
  if (status === "PENDING" && Date.now() - new Date(updatedAt).getTime() > 45_000) {
    return "text-amber-400";
  }

  switch (status) {
    case "QR_READY":
      return "text-emerald-400";
    case "CONNECTED":
      return "text-blue-400";
    case "PENDING":
      return "text-yellow-300";
    case "DISCONNECTED":
    case "AUTH_FAILURE":
      return "text-red-400";
    default:
      return "text-slate-300";
  }
}

function pickDefaultSession(items: SessionRecord[]) {
  return (
    items.find((session) => session.status === "QR_READY") ??
    items.find((session) => session.status === "PENDING") ??
    items.find((session) => session.status === "DISCONNECTED") ??
    items[0]
  );
}

export default function SessionsPage() {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const connectAttemptedRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const accessToken = useAppStore((state) => state.accessToken);
  const { subscribeSession } = useRealtime();

  const { data } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ items: SessionRecord[] }>("/sessions?page=1&pageSize=25"),
    refetchInterval: 5000,
  });

  const { data: selectedSession } = useQuery({
    queryKey: ["session", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => api<SessionDetail>(`/sessions/${selectedId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "PENDING") {
        return 3000;
      }
      return false;
    },
  });

  useEffect(() => {
    const items = data?.items ?? [];
    if (!items.length) {
      return;
    }

    if (selectedId && items.some((session) => session.id === selectedId)) {
      return;
    }

    const next = pickDefaultSession(items);
    if (next) {
      setSelectedId(next.id);
    }
  }, [data?.items, selectedId]);

  useEffect(() => {
    if (selectedId) {
      subscribeSession(selectedId);
    }
  }, [selectedId, subscribeSession]);

  useEffect(() => {
    if (!accessToken || !selectedId) {
      return;
    }

    const socket = getSocket(accessToken);
    const onQrUpdate = (payload: { sessionId: string; qrDataUrl?: string; status?: string }) => {
      if (payload.sessionId !== selectedId || !payload.qrDataUrl) {
        return;
      }

      queryClient.setQueryData<SessionDetail>(["session", selectedId], (current) =>
        current
          ? {
              ...current,
              status: payload.status ?? "QR_READY",
              qrDataUrl: payload.qrDataUrl ?? current.qrDataUrl,
            }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    };

    const onSessionUpdate = (session: SessionRecord) => {
      if (session.id !== selectedId) {
        return;
      }

      queryClient.setQueryData<SessionDetail>(["session", selectedId], (current) =>
        current
          ? {
              ...current,
              ...session,
              qrDataUrl: session.status === "CONNECTED" ? null : current.qrDataUrl,
            }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    };

    socket.on(wsEventNames.qrUpdate, onQrUpdate);
    socket.on(wsEventNames.sessionUpdate, onSessionUpdate);

    return () => {
      socket.off(wsEventNames.qrUpdate, onQrUpdate);
      socket.off(wsEventNames.sessionUpdate, onSessionUpdate);
    };
  }, [accessToken, queryClient, selectedId]);

  useEffect(() => {
    if (!selectedId || !selectedSession) {
      return;
    }

    const needsConnect = selectedSession.status === "PENDING";
    if (!needsConnect || connectAttemptedRef.current.has(selectedId)) {
      return;
    }

    connectAttemptedRef.current.add(selectedId);
    void api(`/sessions/${selectedId}/connect`, {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["session", selectedId] });
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      })
      .catch((error: Error) => {
        connectAttemptedRef.current.delete(selectedId);
        toast.error(error.message);
      });
  }, [queryClient, selectedId, selectedSession]);

  const createMutation = useMutation({
    mutationFn: () =>
      api<SessionRecord>("/sessions", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), autoReconnect: true }),
      }),
    onSuccess: (session) => {
      setName("");
      connectAttemptedRef.current.delete(session.id);
      setSelectedId(session.id);
      toast.success("Session created — preparing QR…");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["session", session.id] });
    },
    onError: (error) => toast.error(error.message),
  });

  const actionMutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "connect" | "disconnect" | "logout" | "reconnect" | "delete";
    }) => {
      if (action === "delete") {
        return api(`/sessions/${id}`, { method: "DELETE" });
      }
      if (action === "connect" || action === "reconnect") {
        connectAttemptedRef.current.delete(id);
      }
      return api(`/sessions/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    },
    onSuccess: (_data, variables) => {
      if (variables.action === "reconnect") {
        toast.success("Refreshing QR code…");
      } else if (variables.action !== "connect") {
        toast.success(`Session ${variables.action} completed`);
      }
      if (variables.action === "delete" && selectedId === variables.id) {
        setSelectedId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["session", variables.id] });
    },
    onError: (error) => toast.error(error.message),
  });

  const refreshQr = (sessionId: string) => {
    actionMutation.mutate({ id: sessionId, action: "reconnect" });
  };

  const pairingMessage = selectedSession
    ? selectedSession.qrDataUrl
      ? "Open WhatsApp on your phone → Linked devices → Link a device, then scan this QR."
      : selectedSession.status === "PENDING"
        ? "Starting Chrome and preparing your QR code. This usually takes 10–20 seconds. Use Refresh QR only if it does not appear."
        : selectedSession.status === "CONNECTED"
          ? `Connected as ${selectedSession.phoneNumber ?? "unknown number"}.`
          : "No QR yet. Click Refresh QR to generate one."
    : null;

  return (
    <DashboardShell title="WhatsApp Sessions">
      <div className="mb-6 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold">Create session</h3>
          <p className="mt-2 text-sm text-slate-400">
            Create a named session (at least 2 characters). The newest session is selected automatically.
          </p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Support Desk 1"
            minLength={2}
            className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
          />
          <button
            type="button"
            disabled={name.trim().length < 2 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-60"
          >
            {createMutation.isPending ? "Creating..." : "Create session"}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-lg font-semibold">QR pairing</h3>
          {selectedSession ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-300">{selectedSession.name}</p>
                <span
                  className={`rounded-full bg-slate-800 px-2.5 py-1 text-xs ${statusClassName(
                    selectedSession.status,
                    selectedSession.updatedAt,
                  )}`}
                >
                  {formatSessionStatus(selectedSession)}
                </span>
              </div>

              <p className="text-sm text-slate-400">{pairingMessage}</p>

              {selectedSession.qrDataUrl ? (
                <img
                  src={selectedSession.qrDataUrl}
                  alt="WhatsApp QR code"
                  className="mx-auto max-w-xs rounded-xl border border-slate-700 bg-white p-3"
                />
              ) : selectedSession.status === "PENDING" ? (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-700 px-6 py-16 text-sm text-slate-400">
                  Preparing QR code…
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={actionMutation.isPending}
                  onClick={() => refreshQr(selectedSession.id)}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500 disabled:opacity-60"
                >
                  {actionMutation.isPending ? "Refreshing..." : "Refresh QR"}
                </button>
                {(["disconnect", "logout", "delete"] as const).map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => actionMutation.mutate({ id: selectedSession.id, action })}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm capitalize hover:bg-slate-800"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">Create a session to start pairing.</p>
          )}
        </div>
      </div>

      <DataTable
        columns={["Session", "Phone", "Status", "Last Seen", "Heartbeat", "Actions"]}
        rows={(data?.items ?? []).map((session) => [
          <span
            key={`${session.id}-name`}
            className={session.id === selectedId ? "font-semibold text-blue-300" : undefined}
          >
            {session.name}
            {session.id === selectedId ? " (selected)" : ""}
          </span>,
          session.phoneNumber,
          <span
            key={`${session.id}-status`}
            className={statusClassName(session.status, session.updatedAt)}
          >
            {formatSessionStatus(session)}
          </span>,
          formatDate(session.lastSeenAt),
          formatDate(session.heartbeatAt),
          <button
            key={session.id}
            type="button"
            onClick={() => {
              connectAttemptedRef.current.delete(session.id);
              setSelectedId(session.id);
            }}
            className={`rounded-lg px-3 py-1 text-sm ${
              session.id === selectedId
                ? "bg-blue-600 text-white"
                : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            Manage
          </button>,
        ])}
      />
    </DashboardShell>
  );
}
