import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadTasks, monthView, ALL } from "@/lib/metrics";
import { currentMonth } from "@/lib/time";
import { TaskDetail } from "@/components/Tasks";

// Stand-alone task page (linked from Cliq alerts and the overview).
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const tasks = await loadTasks({ id });
  if (!tasks.length) notFound();
  const m = monthView(tasks, ALL)[0];
  const mine = m.task.assignees.some((a) => a.userId === user.id);
  if (user.role !== "ADMIN" && !mine) redirect("/me");
  return (
    <div className="mx-auto max-w-2xl card p-6">
      <TaskDetail m={m} month={currentMonth()} canComment={user.role === "ADMIN" || mine} />
    </div>
  );
}
