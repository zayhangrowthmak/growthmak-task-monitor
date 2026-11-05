import { prisma } from "./db";

// Lease-style lock in Postgres so two processes (e.g. old + new deploy overlapping
// for a moment) never run the same job at once. Expires on its own if a process dies.
export async function acquireLock(name: string, minutes = 30): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + minutes * 60_000).toISOString();
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "AppState" ("key", "value", "updatedAt") VALUES (${`lock.${name}`}, ${until}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
    WHERE "AppState"."value" < ${now.toISOString()}
    RETURNING "key"`;
  return rows.length > 0;
}

export async function releaseLock(name: string): Promise<void> {
  await prisma.appState.updateMany({ where: { key: `lock.${name}` }, data: { value: new Date(0).toISOString() } });
}
