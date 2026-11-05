import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifyToken, setSession, currentUser } from "@/lib/auth";
import { prisma, setState } from "@/lib/db";
import { clearTokenCache } from "@/lib/zoho/client";
import { clearMailCache } from "@/lib/mail";
import { fullSync } from "@/lib/zoho/sync";

const fail = (code: string) => NextResponse.redirect(`${config.appUrl}/login?error=${code}`);

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = await verifyToken<{ purpose: string }>(req.nextUrl.searchParams.get("state") ?? "");
  if (!code || !state) return fail("bad_state");

  const tokenRes = await fetch(`${config.zoho.accountsUrl}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: config.zoho.clientId,
      client_secret: config.zoho.clientSecret,
      redirect_uri: `${config.appUrl}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tok = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error?: string };
  if (!tok.access_token) return fail("token_exchange");

  if (state.purpose === "mail") {
    const u = await currentUser();
    if (u?.role !== "ADMIN") return fail("not_admin");
    if (!tok.refresh_token) return NextResponse.redirect(`${config.appUrl}/settings?mail=no_refresh_token`);
    await setState("zohomail.refresh_token", tok.refresh_token);
    await prisma.appState.deleteMany({ where: { key: "zohomail.account" } });
    clearMailCache();
    return NextResponse.redirect(`${config.appUrl}/settings?mail=connected`);
  }

  if (state.purpose === "connect") {
    const u = await currentUser();
    if (u?.role !== "ADMIN") return fail("not_admin");
    if (!tok.refresh_token) return NextResponse.redirect(`${config.appUrl}/settings?zoho=no_refresh_token`);
    await setState("zoho.refresh_token", tok.refresh_token);
    clearTokenCache();
    fullSync().catch((e) => console.error("[sync] after connect failed:", e));
    return NextResponse.redirect(`${config.appUrl}/settings?zoho=connected`);
  }

  const infoRes = await fetch(`${config.zoho.accountsUrl}/oauth/user/info`, {
    headers: { Authorization: `Zoho-oauthtoken ${tok.access_token}` },
  });
  const info = (await infoRes.json()) as { Email?: string; Display_Name?: string; First_Name?: string; Last_Name?: string };
  const email = info.Email?.toLowerCase();
  if (!email) return fail("no_email");

  let user = await prisma.user.findUnique({ where: { email } });
  const isAdmin = config.adminEmails.includes(email);
  const domainOk = config.allowedEmailDomain ? email.endsWith(`@${config.allowedEmailDomain}`) : false;
  if (!user && (isAdmin || domainOk)) {
    user = await prisma.user.create({
      data: { email, name: info.Display_Name || [info.First_Name, info.Last_Name].filter(Boolean).join(" ") || email, role: isAdmin ? "ADMIN" : "MEMBER" },
    });
  }
  if (!user || !user.active) return fail("not_in_portal");
  if (isAdmin && user.role !== "ADMIN") user = await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

  await setSession(user.id);
  return NextResponse.redirect(`${config.appUrl}${user.role === "ADMIN" ? "/overview" : "/me"}`);
}
