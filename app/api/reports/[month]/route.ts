import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { generateReport, reportAvailable } from "@/lib/jobs/monthEnd";
import { isValidMonth } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const u = await currentUser();
  if (u?.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isValidMonth(month)) return NextResponse.json({ error: "bad month" }, { status: 400 });
  if (!reportAvailable(month)) return NextResponse.json({ error: "This month's report is available from the 1st of next month." }, { status: 409 });
  const pdf = await generateReport(month, req.nextUrl.searchParams.get("regenerate") === "1");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="growthmak-delivery-report-${month}.pdf"`,
    },
  });
}
