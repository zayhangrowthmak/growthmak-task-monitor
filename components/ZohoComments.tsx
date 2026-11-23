// Comments written in Zoho, shown inside the dashboard (Zoho → dashboard half of the two-way sync).
// Loaded when a task is opened, cached for 3 minutes, and never blocks the panel.
import { listComments, type ZohoComment } from "@/lib/zoho/write";
import { fmtDateTime } from "@/lib/time";

const cache = new Map<string, { at: number; items: ZohoComment[] | null }>();

async function load(projectId: string, taskId: string) {
  const hit = cache.get(taskId);
  if (hit && Date.now() - hit.at < 180_000) return hit.items;
  const items = await listComments(projectId, taskId).catch(() => null);
  cache.set(taskId, { at: Date.now(), items });
  return items;
}

export async function ZohoComments({ projectId, taskId }: { projectId: string; taskId: string }) {
  const items = await load(projectId, taskId);
  if (items === null) return <p className="text-xs text-ink-3">Couldn&apos;t load comments from Zoho right now.</p>;
  if (!items.length) return <p className="text-sm text-ink-3">No comments in Zoho yet.</p>;
  return (
    <div className="space-y-2">
      {items.slice(0, 10).map((c) => (
        <div key={c.id || c.text.slice(0, 20)} className="rounded-lg border border-line bg-field p-2.5 text-sm">
          <div className="flex justify-between gap-3 text-[11px] text-ink-3">
            <b className="text-ink-2">{c.author}</b>
            <span>{c.at ? fmtDateTime(c.at) : ""}</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap">{c.text}</div>
        </div>
      ))}
    </div>
  );
}
