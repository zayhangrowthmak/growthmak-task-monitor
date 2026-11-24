// Reply / follow up on a task. The text is posted as a comment on the Zoho task, with "@Name" for each
// person tagged, and the tagged people are pinged in Cliq. Team members answer in Zoho.
import { prisma } from "@/lib/db";
import { postUpdateAction } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

type Person = { id: string; name: string };

export async function UpdateForm({ taskId, kind = "reply", compact, back }: { taskId: string; kind?: "reply" | "follow_up"; compact?: boolean; back?: string }) {
  const [task, everyone] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { assignees: { select: { role: true, user: { select: { id: true, name: true, active: true } } } } } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const onTask: Person[] = (task?.assignees ?? [])
    .filter((a) => a.user.active)
    .sort((a, b) => (a.role === "OWNER" ? 1 : 0) - (b.role === "OWNER" ? 1 : 0))
    .map((a) => a.user)
    .filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i);
  const others = everyone.filter((u) => !onTask.some((x) => x.id === u.id));
  const defaultTag = kind === "follow_up" ? onTask[0]?.id : undefined;
  const chip = (p: Person, checked?: boolean) => (
    <label key={p.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-dark">
      <input type="checkbox" name="tag" value={p.id} defaultChecked={checked} className="h-3.5 w-3.5 min-h-0 p-0" />@{p.name}
    </label>
  );
  return (
    <form action={postUpdateAction} className={`space-y-2 rounded-lg border border-line bg-plane/60 ${compact ? "p-2.5" : "p-3"}`}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="kind" value={kind} />
      {back && <input type="hidden" name="back" value={back} />}
      <label className="block">
        <span className="label">{kind === "follow_up" ? "Follow up" : "Reply"} <span className="font-normal normal-case text-ink-3">· posted on the Zoho task</span></span>
        <textarea
          name="text"
          required
          minLength={2}
          maxLength={2000}
          rows={compact ? 2 : 3}
          placeholder={kind === "follow_up" ? "What's the latest on this? When will it be done?" : "Write a reply"}
          className="mt-1 w-full"
          defaultValue={kind === "follow_up" ? "Hi, what's the latest on this? Please update the task with the status and a date." : undefined}
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-2">Tag</span>
        {onTask.map((p) => chip(p, p.id === defaultTag))}
        {others.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink">+ someone else</summary>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{others.map((p) => chip(p))}</div>
          </details>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-3">Tagged people also get a Cliq message.</p>
        <SubmitButton icon="send">{kind === "follow_up" ? "Send follow-up" : "Post reply"}</SubmitButton>
      </div>
    </form>
  );
}
