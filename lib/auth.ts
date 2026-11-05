import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";

const COOKIE = "gm_session";
const key = () => new TextEncoder().encode(config.sessionSecret);

export async function signToken(payload: Record<string, unknown>, ttl = "14d"): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(ttl).sign(key());
}

export async function verifyToken<T = Record<string, unknown>>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as T;
  } catch {
    return null;
  }
}

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, await signToken({ uid: userId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.appUrl.startsWith("https"),
    path: "/",
    maxAge: 14 * 86400,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const p = await verifyToken<{ uid: string }>(token);
  if (!p?.uid) return null;
  const u = await prisma.user.findUnique({ where: { id: p.uid } });
  return u?.active ? u : null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "ADMIN") redirect("/me");
  return u;
}

export const isAdmin = (u: User | null) => u?.role === "ADMIN";
