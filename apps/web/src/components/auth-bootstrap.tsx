"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { bootstrapAuth } from "@/lib/auth";
import { getAccessToken } from "@/lib/auth-tokens";
import { useAppStore } from "@/lib/store";
import { useRealtime } from "@/lib/socket";

const publicPaths = new Set(["/", "/login"]);

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAppStore((state) => state.user);
  const setAccessToken = useAppStore((state) => state.setAccessToken);
  useRealtime();

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      setAccessToken(token);
    }
  }, [setAccessToken]);

  useEffect(() => {
    let active = true;

    void bootstrapAuth().then((result) => {
      if (!active) {
        return;
      }
      if (!result && !publicPaths.has(pathname)) {
        router.replace("/login");
      }
    });

    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (!user && !publicPaths.has(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        Restoring session...
      </div>
    );
  }

  return children;
}
