import { redirect } from "next/navigation";

// The member view was retired: team members work in Zoho Projects. Old links land on the overview.
export default function Me() {
  redirect("/overview");
}
