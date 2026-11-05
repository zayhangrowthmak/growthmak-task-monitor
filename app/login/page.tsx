import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { config, zohoConfigured } from "@/lib/config";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";

const ERRORS: Record<string, string> = {
  not_in_portal: "Your Zoho account isn't in the Growthmak Projects portal yet. Ask an admin to add you, then try again.",
  zoho_not_configured: "Zoho sign-in isn't configured on this server yet (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET).",
  bad_state: "The sign-in link expired. Please try again.",
  token_exchange: "Zoho sign-in failed. Please try again.",
  no_email: "Zoho didn't share an email address for this account.",
  not_admin: "Only admins can connect the Zoho sync account.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await currentUser();
  if (u) redirect(u.role === "ADMIN" ? "/overview" : "/me");
  const sp = await searchParams;
  const demoUsers = config.demoMode ? await prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }) : [];
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card w-full max-w-sm p-7">
        <Logo height={40} />
        <div className="mt-4 text-lg font-semibold">Task Monitor</div>
        <p className="mt-2 text-sm text-ink-2">Sign in with your Zoho account to see your tasks and progress.</p>
        {sp.error && <div className="mt-4 rounded-lg bg-crit/10 p-3 text-sm text-crit">{ERRORS[sp.error] ?? "Sign-in failed."}</div>}
        {zohoConfigured() && <a href="/api/auth/login" className="btn btn-primary mt-5 w-full justify-center py-2">Sign in with Zoho</a>}
        {config.demoMode && (
          <div className="mt-6">
            <div className="label mb-2">Demo: view as</div>
            <div className="grid grid-cols-2 gap-2">
              {demoUsers.map((d) => (
                <a key={d.id} href={`/api/auth/demo?uid=${d.id}`} className="btn justify-center">
                  {d.name}{d.role === "ADMIN" && <span className="text-[10px] text-ink-3">admin</span>}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
