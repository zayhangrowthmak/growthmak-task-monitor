import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { config } from "@/lib/config";

export async function POST() {
  await clearSession();
  return NextResponse.redirect(`${config.appUrl}/login`, { status: 303 });
}
