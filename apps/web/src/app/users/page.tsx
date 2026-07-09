"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "AGENT",
  });

  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<UserRecord[]>("/users"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<UserRecord>("/users", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success("User created");
      setForm({ name: "", email: "", password: "", role: "AGENT" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (user: UserRecord) =>
      api(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell title="Users">
      <div className="mb-6 grid gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:grid-cols-2">
        <input
          value={form.name}
          onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
          placeholder="Full name"
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
        />
        <input
          value={form.email}
          onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))}
          placeholder="Email"
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
        />
        <input
          type="password"
          value={form.password}
          onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
          placeholder="Password"
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
        />
        <select
          value={form.role}
          onChange={(event) => setForm((state) => ({ ...state, role: event.target.value }))}
          className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
        >
          <option value="AGENT">Agent</option>
          <option value="ADMIN">Admin</option>
          <option value="SUPER_ADMIN">Super Admin</option>
        </select>
        <button
          type="button"
          disabled={!form.name || !form.email || form.password.length < 8 || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-60 lg:col-span-2 lg:w-fit"
        >
          Create user
        </button>
      </div>

      <DataTable
        columns={["Name", "Email", "Role", "Active", "Action"]}
        rows={(data ?? []).map((user) => [
          user.name,
          user.email,
          user.role,
          user.isActive ? "Yes" : "No",
          <button
            key={user.id}
            type="button"
            onClick={() => toggleMutation.mutate(user)}
            className="rounded-lg bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
          >
            {user.isActive ? "Deactivate" : "Activate"}
          </button>,
        ])}
      />
    </DashboardShell>
  );
}
