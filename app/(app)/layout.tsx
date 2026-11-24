import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { MainNav, ThemeToggle, type NavItem } from "@/components/Header";
import { Icon } from "@/components/Icon";
import { FeedbackButton } from "@/components/Feedback";
import { Logo } from "@/components/Logo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { newUpdatesCount } = await import("@/lib/updates");
  const fresh = await newUpdatesCount(user.id).catch(() => 0);
  const nav: NavItem[] = [
    { href: "/overview", label: "Overview", icon: "grid" },
    { href: "/people", label: "Individual", icon: "user" },
    { href: "/clients", label: "Clients", icon: "briefcase" },
    { href: "/plan", label: "Plan", icon: "calendar" },
    { href: "/updates", label: "Task updates", icon: "message", count: fresh },
    { href: "/review", label: "Old tasks", icon: "history" },
    { href: "/reports", label: "Reports", icon: "file" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ];
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/70">
        <div className="mx-auto grid max-w-[2400px] grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6 lg:px-8 min-[1860px]:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Growthmak Task Monitor home">
            <Logo height={26} />
            <span className="hidden whitespace-nowrap border-l border-line pl-3 text-sm font-medium text-ink-2 md:inline">Task Monitor</span>
          </Link>
          <div className="col-span-2 row-start-2 min-w-0 min-[1860px]:col-span-1 min-[1860px]:col-start-2 min-[1860px]:row-start-1">
            <MainNav items={nav} />
          </div>
          <div className="flex items-center justify-end gap-2 text-sm min-[1860px]:col-start-3">
            {config.demoMode && <span className="whitespace-nowrap rounded-md bg-warn/25 px-2 py-0.5 text-xs font-semibold text-warnText">Demo data</span>}
            <FeedbackButton />
            <ThemeToggle />
            <span className="hidden max-w-[12rem] truncate whitespace-nowrap pl-1 text-ink-2 lg:inline" title={user.email}>
              {user.name}
            </span>
            <form action="/api/auth/logout" method="post">
              <button className="btn max-lg:btn-icon" aria-label="Sign out" title="Sign out">
                <Icon name="logout" />
                <span className="hidden lg:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[2400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
