"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type NavItem = { href: string; label: string; icon: IconName; count?: number };

/** Top navigation. Runs in the browser so the active tab follows every page change.
 *  Below 1536px it sits on its own row and scrolls sideways instead of squeezing the header. */
export function MainNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="scroll-x no-scrollbar fade-x -mx-1 flex min-w-0 gap-0.5 px-1">
      {items.map((n) => {
        const active = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors max-sm:min-h-[40px] ${
              active ? "bg-brand-soft text-brand-dark" : "text-ink-2 hover:bg-plane hover:text-ink"
            }`}
          >
            <Icon name={n.icon} size={15} className={active ? "" : "opacity-80"} />
            {n.label}
            {!!n.count && (
              <span className="num min-w-[18px] rounded-full bg-crit px-1.5 text-center text-[11px] font-semibold leading-[18px] text-white" aria-label={`${n.count} waiting`}>
                {n.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Light / dark switch. Remembers the choice in a cookie; with no choice it follows the system. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    document.cookie = `theme=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
    setDark(next);
  };
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" onClick={toggle} className="btn btn-icon" aria-label={label} title={label}>
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}
