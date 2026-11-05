import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export async function getState(key: string): Promise<string | null> {
  const row = await prisma.appState.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  await prisma.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
}
