import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Growthmak Task Monitor", description: "Delivery monitoring for the Growthmak team" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
