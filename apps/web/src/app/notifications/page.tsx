"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationRecord[]>("/notifications"),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell title="Notifications">
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          disabled={markAllReadMutation.isPending || !data?.some((item) => !item.readAt)}
          onClick={() => markAllReadMutation.mutate()}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-60"
        >
          Mark all read
        </button>
      </div>
      <DataTable
        columns={["Title", "Message", "Type", "Created", "Status", "Action"]}
        rows={(data ?? []).map((notification) => [
          notification.title,
          notification.body,
          notification.type,
          formatDate(notification.createdAt),
          notification.readAt ? "Read" : "Unread",
          notification.readAt ? (
            "—"
          ) : (
            <button
              key={`${notification.id}-read`}
              type="button"
              onClick={() => markReadMutation.mutate(notification.id)}
              className="rounded-lg bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
            >
              Mark read
            </button>
          ),
        ])}
      />
    </DashboardShell>
  );
}
