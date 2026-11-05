/* eslint-disable @next/next/no-img-element */
/** Growthmak logo; swaps to the light-text version in dark mode. */
export function Logo({ height = 28, className = "" }: { height?: number; className?: string }) {
  const width = Math.round(height * 3.92);
  return (
    <span className={`inline-flex ${className}`} style={{ height }}>
      <img src="/logo.png" alt="Growthmak" width={width} height={height} className="block h-full w-auto dark:hidden" />
      <img src="/logo-dark.png" alt="Growthmak" width={width} height={height} className="hidden h-full w-auto dark:block" />
    </span>
  );
}
