import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Praxis Protocol — Agent Accountability Dashboard",
  description:
    "On-chain accountability for autonomous AI agents: staked bonds, hashed decision attestations, challenge-and-slash disputes, and portable reputation.",
};

export const viewport: Viewport = {
  themeColor: "#050912",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
