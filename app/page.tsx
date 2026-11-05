import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export default async function Home() {
  const u = await currentUser();
  redirect(!u ? "/login" : u.role === "ADMIN" ? "/overview" : "/me");
}
