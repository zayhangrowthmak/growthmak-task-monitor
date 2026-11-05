"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Top navigation. Runs in the browser so the active tab follows every page change. */
export function MainNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1">
      {items.map((n) => {
        const active = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-brand-soft text-brand-dark" : "text-ink-2 hover:bg-plane"}`}
          >
            {n.label}
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
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn px-2.5"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span aria-hidden className="text-base leading-none">{dark ? "☀" : "☾"}</span>
      <span className="hidden sm:inline">{dark === null ? "Theme" : dark ? "Light" : "Dark"}</span>
    </button>
  );
}
