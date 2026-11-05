import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { MainNav, ThemeToggle } from "@/components/Header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const nav = admin
    ? [
        { href: "/overview", label: "Overview" },
        { href: "/people", label: "Individual" },
        { href: "/reports", label: "Reports" },
        { href: "/settings", label: "Settings" },
      ]
    : [{ href: "/me", label: "My dashboard" }];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-5 py-2.5">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-sm text-white">G</span>
            <span>Growthmak <span className="text-ink-2 font-normal">Task Monitor</span></span>
          </Link>
          <MainNav items={nav} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            {config.demoMode && <span className="rounded bg-warn/30 px-2 py-0.5 text-xs font-semibold">Demo data</span>}
            <ThemeToggle />
            <span className="text-ink-2">{user.name}{admin && <span className="ml-1 text-xs text-ink-3">(Admin)</span>}</span>
            <form action="/api/auth/logout" method="post">
              <button className="btn">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>
    </div>
  );
}
