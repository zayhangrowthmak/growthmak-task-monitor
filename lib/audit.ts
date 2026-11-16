import type { Prisma, User } from "@prisma/client";
import { prisma } from "./db";

/** Append-only audit trail: plan changes, due-date changes, review decisions, approvals, remarks. */
export async function audit(actor: Pick<User, "id" | "name"> | null, action: string, entity: string, entityId?: string | null, detail?: unknown) {
  await prisma.auditLog.create({
    data: { actorId: actor?.id, actor: actor?.name ?? "system", action, entity, entityId: entityId ?? undefined, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}
