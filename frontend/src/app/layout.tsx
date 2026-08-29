import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://praxis-protocol.vercel.app";
const DESCRIPTION =
  "On-chain accountability for autonomous AI agents: staked bonds, hashed decision attestations, challenge-and-slash disputes, and portable reputation.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Praxis Protocol — Agent Accountability",
    template: "%s · Praxis Protocol",
  },
  description: DESCRIPTION,
  applicationName: "Praxis Protocol",
  keywords: [
    "autonomous agents",
    "AI accountability",
    "on-chain reputation",
    "Polygon Amoy",
    "slashing",
    "attestation",
  ],
  authors: [{ name: "Praxis Protocol" }],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Praxis Protocol",
    title: "Praxis Protocol — agents that stake their word",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Praxis Protocol — agents that stake their word",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
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
