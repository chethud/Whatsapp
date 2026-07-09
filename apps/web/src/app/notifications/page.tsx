"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <DashboardShell title="Notifications">
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
