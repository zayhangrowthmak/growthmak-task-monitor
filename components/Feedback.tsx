"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback } from "@/app/actions";

const TYPES = [
  { key: "FEATURE", label: "Feature request", hint: "Something you'd like the dashboard to do" },
  { key: "PROBLEM", label: "Problem / bug", hint: "Something broken or not working as expected" },
  { key: "DATA_ISSUE", label: "Wrong data", hint: "A number, task or status that doesn't match Zoho" },
  { key: "OTHER", label: "Other", hint: "Anything else" },
];

/** Header button that opens the feedback form. Sends to the admin's Zoho Mail. */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const [state, action, pending] = useActionState(submitFeedback, null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span aria-hidden>✉</span>
        <span className="hidden sm:inline">Feedback</span>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="w-full max-w-lg rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
      >
        {state?.ok ? (
          <div className="p-6 text-center">
            <div className="text-3xl" aria-hidden>✓</div>
            <h2 className="mt-2 text-lg font-semibold">Feedback sent</h2>
            <p className="mt-1 text-sm text-ink-2">{state.message}</p>
            <button className="btn btn-primary mt-5" onClick={() => location.reload()}>Done</button>
          </div>
        ) : (
          <form action={action} className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Send feedback</h2>
                <p className="text-sm text-ink-2">Ideas, problems or anything that looks wrong. It goes straight to the admin.</p>
              </div>
              <button type="button" className="btn px-2" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <input type="hidden" name="page" value={path} />
            <fieldset>
              <legend className="label mb-2">What is it about?</legend>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map((t, i) => (
                  <label key={t.key} className="flex cursor-pointer gap-2 rounded-lg border border-line bg-field p-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                    <input type="radio" name="type" value={t.key} defaultChecked={i === 0} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{t.label}</span>
                      <span className="block text-xs text-ink-2">{t.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="label">Subject</span>
              <input name="subject" required minLength={3} maxLength={150} placeholder="e.g. Show logged hours per client" className="mt-1 w-full" />
            </label>
            <label className="block">
              <span className="label">Details</span>
              <textarea name="message" required minLength={5} maxLength={5000} rows={5} placeholder="What happened, what you expected, or what you'd like to see." className="mt-1 w-full" />
            </label>
            <p className="text-xs text-ink-3">We'll include your name, email and the page you're on ({path}) so it's easy to follow up.</p>
            {state && !state.ok && <p className="rounded-lg bg-crit/10 px-3 py-2 text-sm text-crit">{state.message}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={pending}>{pending ? "Sending…" : "Send feedback"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
