"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bell,
  Bot,
  BarChart3,
  ContactRound,
  LayoutDashboard,
  MessageSquare,
  Moon,
  NotebookText,
  QrCode,
  Settings,
  Shield,
  UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

const navItems: Array<{ href: Route; label: string; icon: typeof LayoutDashboard }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sessions", label: "WhatsApp Sessions", icon: QrCode },
  { href: "/chats", label: "Chats", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: ContactRound },
  { href: "/ai-assistant", label: "AI Assistant", icon: Bot },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/users", label: "Users", icon: Shield },
  { href: "/logs", label: "Logs", icon: NotebookText },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function DashboardShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const user = useAppStore((state) => state.user);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      <aside className="hidden w-72 flex-col border-r border-slate-800 bg-slate-900/70 p-6 lg:flex">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">WhatsApp Core</p>
          <h1 className="mt-2 text-2xl font-semibold">Automation Platform</h1>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition",
                  pathname === item.href
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="mt-auto flex items-center gap-3 rounded-xl border border-slate-800 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800"
        >
          <Moon className="h-4 w-4" />
          Dark Mode
        </button>
      </aside>

      <main className="flex-1">
        <div className="border-b border-slate-800 bg-slate-950/95 px-6 py-5 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold">{title}</h2>
            {user ? (
              <p className="text-sm text-slate-400">
                {user.name} · {user.role}
              </p>
            ) : null}
          </div>
        </div>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
