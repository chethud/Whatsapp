import type { Metadata } from "next";

import "./globals.css";
import { AuthBootstrap } from "@/components/auth-bootstrap";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "WhatsApp Core Platform",
  description: "Production-grade WhatsApp automation and AI chatbot dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <AuthBootstrap>{children}</AuthBootstrap>
        </Providers>
      </body>
    </html>
  );
}
