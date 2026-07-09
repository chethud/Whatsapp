"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";

type ContactRecord = {
  id: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  leadScore: number;
};

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", phoneNumber: "", email: "" });
  const [search, setSearch] = useState("");
  const { data } = useQuery({
    queryKey: ["contacts", search],
    queryFn: () =>
      api<{ items: ContactRecord[] }>(
        `/contacts?page=1&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<ContactRecord>("/contacts", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          tags: [],
          labels: [],
          customFields: {},
          favorite: false,
          blocked: false,
          leadScore: 0,
        }),
      }),
    onSuccess: () => {
      setForm({ name: "", phoneNumber: "", email: "" });
      toast.success("Contact created");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DashboardShell title="Contacts">
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            value={form.name}
            onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
            placeholder="Contact name"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
          />
          <input
            value={form.phoneNumber}
            onChange={(event) => setForm((state) => ({ ...state, phoneNumber: event.target.value }))}
            placeholder="Phone number"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
          />
          <input
            value={form.email}
            onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))}
            placeholder="Email"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
          />
        </div>
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          className="mt-4 rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500"
        >
          Add contact
        </button>
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search contacts..."
        className="mb-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
      />

      <DataTable
        columns={["Name", "Phone", "Email", "Lead Score"]}
        rows={(data?.items ?? []).map((contact) => [
          contact.name,
          contact.phoneNumber,
          contact.email,
          contact.leadScore,
        ])}
      />
    </DashboardShell>
  );
}
