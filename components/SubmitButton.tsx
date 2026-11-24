"use client";
import { useFormStatus } from "react-dom";
import { Icon, type IconName } from "./Icon";

/** Primary submit button that shows it's working and can't be pressed twice. */
export function SubmitButton({ children, icon }: { children: React.ReactNode; icon?: IconName }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" disabled={pending} aria-busy={pending}>
      {icon && <Icon name={pending ? "refresh" : icon} size={14} className={pending ? "animate-spin" : ""} />}
      {pending ? "Sending…" : children}
    </button>
  );
}
