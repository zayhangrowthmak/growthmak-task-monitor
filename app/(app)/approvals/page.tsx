import { redirect } from "next/navigation";

// Approvals was replaced by Task updates (the dashboard no longer changes tasks in Zoho).
export default function Approvals() {
  redirect("/updates");
}
