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
  const admin = user.role === "ADMIN";
  const pendingApprovals = admin ? await prisma.zohoChange.count({ where: { status: { in: ["PENDING", "FAILED"] } } }) : 0;
  const nav: NavItem[] = admin
    ? [
        { href: "/overview", label: "Overview" },
        { href: "/people", label: "Individual" },
        { href: "/clients", label: "Clients" },
        { href: "/plan", label: "Plan" },
        { href: "/review", label: "Review" },
        { href: "/approvals", label: "Approvals", count: pendingApprovals },
        { href: "/reports", label: "Reports" },
        { href: "/settings", label: "Settings" },
      ]
    : [
        { href: "/me", label: "My dashboard" },
        { href: "/review", label: "Review" },
        { href: "/backlog", label: "Backlog" },
      ];
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-5 2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Growthmak Task Monitor home">
            <Logo height={26} />
            <span className="hidden whitespace-nowrap border-l border-line pl-3 text-sm font-medium text-ink-2 md:inline">Task Monitor</span>
          </Link>
          <div className="col-span-2 row-start-2 min-w-0 2xl:col-span-1 2xl:col-start-2 2xl:row-start-1">
            <MainNav items={nav} />
          </div>
          <div className="flex items-center justify-end gap-2 text-sm 2xl:col-start-3">
            {config.demoMode && <span className="whitespace-nowrap rounded-md bg-warn/25 px-2 py-0.5 text-xs font-semibold text-warnText">Demo data</span>}
            <FeedbackButton />
            <ThemeToggle />
            <span className="hidden max-w-[12rem] truncate whitespace-nowrap pl-1 text-ink-2 lg:inline" title={user.email}>
              {user.name}
              {admin && <span className="ml-1 text-xs text-ink-3">Admin</span>}
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
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-5">{children}</main>
    </div>
  );
}
