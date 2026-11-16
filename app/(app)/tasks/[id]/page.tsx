import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadTasks, monthData, scoreRow } from "@/lib/metrics";
import { getSettings } from "@/lib/settings";
import { currentMonth } from "@/lib/time";
import { TaskDetail } from "@/components/Tasks";

// Stand-alone task page (linked from Cliq alerts and lists).
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [t] = await loadTasks({ id });
  if (!t) notFound();
  const mine = t.assignees.some((a) => a.userId === user.id);
  if (user.role !== "ADMIN" && !mine) redirect("/me");
  const month = currentMonth();
  const d = await monthData(month, { tasks: [t] });
  const row = d.rows[0] ?? d.unplannedOpen[0] ?? d.unplannedDone[0] ?? scoreRow(t, { month, plannedDue: t.dueDate, source: "UNPLANNED", asOf: new Date(), settings: await getSettings(), live: true });
  const dueChanges = await prisma.dueDateChange.findMany({ where: { taskId: t.id }, orderBy: { changedAt: "desc" }, take: 10 });
  return (
    <div className="mx-auto max-w-2xl card p-6">
      <TaskDetail r={row} month={month} canEdit={user.role === "ADMIN" || mine} dueChanges={dueChanges} />
    </div>
  );
}
