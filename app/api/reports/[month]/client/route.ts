import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { renderClientPdf } from "@/lib/report";
import { isValidMonth } from "@/lib/time";

export const runtime = "nodejs";

// Client-friendly one-pager (no internal ratings). Admins only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const u = await currentUser();
  if (u?.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!isValidMonth(month) || !name) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const pdf = await renderClientPdf(month, name);
  const safe = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${req.nextUrl.searchParams.get("view") ? "inline" : "attachment"}; filename="${safe}-${month}-deliverables.pdf"`, "Cache-Control": "private, no-store" },
  });
}
