"use client";

import { useQuery } from "@tanstack/react-query";

import { DashboardShell } from "@/components/dashboard-shell";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  user?: { name: string; email: string };
};

export default function LogsPage() {
  const { data } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => api<AuditLog[]>("/logs/audit"),
  });

  return (
    <DashboardShell title="Logs">
      <DataTable
        columns={["Action", "Entity", "User", "Created"]}
        rows={(data ?? []).map((log) => [
          log.action,
          log.entityType,
          log.user?.email ?? "System",
          formatDate(log.createdAt),
        ])}
      />
    </DashboardShell>
  );
}
