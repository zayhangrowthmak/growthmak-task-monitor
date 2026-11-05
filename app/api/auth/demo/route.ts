import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Demo mode only: sign in as any seeded person to preview their view.
export async function GET(req: NextRequest) {
  if (!config.demoMode) return NextResponse.json({ error: "Demo mode is off" }, { status: 404 });
  const u = await prisma.user.findUnique({ where: { id: req.nextUrl.searchParams.get("uid") ?? "" } });
  if (!u) return NextResponse.redirect(`${config.appUrl}/login`);
  await setSession(u.id);
  return NextResponse.redirect(`${config.appUrl}${u.role === "ADMIN" ? "/overview" : "/me"}`);
}
