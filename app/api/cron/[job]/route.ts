import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { fullSync } from "@/lib/zoho/sync";
import { refreshConfidence } from "@/lib/jobs/confidence";
import { closePreviousMonthIfNeeded } from "@/lib/jobs/monthEnd";

// Optional external trigger: GET /api/cron/sync|confidence|month-end with header
// Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!config.jobs.cronSecret || req.headers.get("authorization") !== `Bearer ${config.jobs.cronSecret}`)
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    if (job === "sync") return NextResponse.json({ ok: true, detail: await fullSync() });
    if (job === "confidence") return NextResponse.json({ ok: true, ...(await refreshConfidence()) });
    if (job === "month-end") return NextResponse.json({ ok: true, closed: await closePreviousMonthIfNeeded() });
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
