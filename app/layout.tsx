import "./globals.css";
import type { Metadata } from "next";
import { cookies } from "next/headers";

export const metadata: Metadata = { title: "Growthmak Task Monitor", description: "Delivery monitoring for the Growthmak team" };

// Applies the system theme before first paint when no choice is saved (no flash).
const systemTheme = `try{if(!document.cookie.match(/(?:^|; )theme=/)&&matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang="en" className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>{!theme && <script dangerouslySetInnerHTML={{ __html: systemTheme }} />}</head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
