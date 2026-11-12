import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GridAccess | Community Energy Resilience Planner",
  description: "Map community energy demand, model supply systems, and stress-test service reliability under outages and growth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
