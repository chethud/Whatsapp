"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api, wakeApi } from "@/lib/api";
import { setAuthTokens } from "@/lib/auth-tokens";
import { bootstrapAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";

export default function LoginPage() {
  const router = useRouter();
  const setAccessToken = useAppStore((state) => state.setAccessToken);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [apiStatus, setApiStatus] = useState<"checking" | "ready" | "slow">("checking");

  useEffect(() => {
    let active = true;

    void wakeApi()
      .then(() => {
        if (active) {
          setApiStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setApiStatus("slow");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const loginMutation = useMutation({
    mutationFn: () =>
      api<{ accessToken: string; refreshToken: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (data) => {
      setAuthTokens(data.accessToken, data.refreshToken);
      setAccessToken(data.accessToken);
      void bootstrapAuth();
      toast.success("Logged in");
      router.push("/dashboard");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-blue-400">WhatsApp Core</p>
        <h1 className="mt-4 text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in with the seeded super admin to start pairing sessions and managing chats.
        </p>
        {apiStatus === "checking" ? (
          <p className="mt-3 text-sm text-amber-300">Connecting to API…</p>
        ) : apiStatus === "slow" ? (
          <p className="mt-3 text-sm text-amber-300">
            API is waking up. Sign in may take up to a minute on the free Render plan.
          </p>
        ) : null}

        <div className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => loginMutation.mutate()}
          className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-500"
        >
          {loginMutation.isPending
            ? "Signing in..."
            : apiStatus === "checking"
              ? "Connecting..."
              : "Sign in"}
        </button>
      </div>
    </div>
  );
}
