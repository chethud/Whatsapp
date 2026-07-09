"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DashboardShell } from "@/components/dashboard-shell";
import { api } from "@/lib/api";
import { logout } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { formatDate } from "@/lib/utils";

export default function ProfilePage() {
  const router = useRouter();
  const user = useAppStore((state) => state.user);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");

  const passwordMutation = useMutation({
    mutationFn: () =>
      api("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, nextPassword }),
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNextPassword("");
      toast.success("Password updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <DashboardShell title="Profile">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-lg font-semibold">Account</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-400">Name</dt>
              <dd>{user?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Email</dt>
              <dd>{user?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Role</dt>
              <dd>{user?.role ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Member since</dt>
              <dd>{formatDate(user?.createdAt ?? null)}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 rounded-xl border border-slate-700 px-4 py-3 text-sm hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-lg font-semibold">Change password</h3>
          <div className="mt-4 space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Current password"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            />
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              placeholder="New password"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
            />
            <button
              type="button"
              disabled={!currentPassword || nextPassword.length < 8 || passwordMutation.isPending}
              onClick={() => passwordMutation.mutate()}
              className="rounded-xl bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-60"
            >
              Update password
            </button>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
