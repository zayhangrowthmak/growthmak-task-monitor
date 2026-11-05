import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Empty } from "@/components/ui";

export default async function People({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const first = await prisma.user.findFirst({ where: { active: true, assignments: { some: {} } }, orderBy: { name: "asc" } });
  if (first) redirect(`/people/${first.id}${sp.month ? `?month=${sp.month}` : ""}`);
  return <Empty>No one has tasks yet. Connect Zoho in Settings to pull the team in.</Empty>;
}
