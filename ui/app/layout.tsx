import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Desk — Investment workspace",
  description: "Track startup signals, review evidence, and prepare thoughtful investment outreach.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
