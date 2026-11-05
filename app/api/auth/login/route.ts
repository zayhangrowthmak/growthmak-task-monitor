import { NextRequest, NextResponse } from "next/server";
import { config, zohoConfigured } from "@/lib/config";
import { signToken, currentUser } from "@/lib/auth";

// Starts Zoho OAuth. purpose=login signs a person in; purpose=connect links the sync account (admins only).
export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get("purpose") === "connect" ? "connect" : "login";
  if (!zohoConfigured()) return NextResponse.redirect(`${config.appUrl}/login?error=zoho_not_configured`);
  if (purpose === "connect") {
    const u = await currentUser();
    if (u?.role !== "ADMIN") return NextResponse.redirect(`${config.appUrl}/login`);
  }
  const state = await signToken({ purpose }, "10m");
  const url = new URL(`${config.zoho.accountsUrl}/oauth/v2/auth`);
  url.searchParams.set("client_id", config.zoho.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${config.appUrl}/api/auth/callback`);
  url.searchParams.set("scope", purpose === "connect" ? `${config.zoho.syncScopes},${config.zoho.loginScopes}` : config.zoho.loginScopes);
  url.searchParams.set("state", state);
  if (purpose === "connect") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return NextResponse.redirect(url);
}
