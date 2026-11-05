import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PersonDashboard } from "@/components/PersonDashboard";

export default async function Person({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const viewer = await requireUser();
  const { id } = await params;
  if (viewer.role !== "ADMIN" && viewer.id !== id) redirect("/me");
  const person = await prisma.user.findUnique({ where: { id } });
  if (!person) notFound();
  return <PersonDashboard person={person} viewer={viewer} sp={await searchParams} basePath={`/people/${id}`} />;
}
