import { requireUser } from "@/lib/auth";
import { PersonDashboard } from "@/components/PersonDashboard";

export default async function Me({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  return <PersonDashboard person={user} viewer={user} sp={await searchParams} basePath="/me" />;
}
