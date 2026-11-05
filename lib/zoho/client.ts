// Thin Zoho Projects V3 API client: OAuth refresh, rate limiting, pagination.
import { config } from "../config";
import { getState, setState } from "../db";

type Token = { access: string; expiresAt: number };
let cached: Token | null = null;

export async function getRefreshToken(): Promise<string> {
  return config.zoho.refreshToken || (await getState("zoho.refresh_token")) || "";
}

export async function zohoConnected(): Promise<boolean> {
  return Boolean(await getRefreshToken());
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.access;
  const refresh = await getRefreshToken();
  if (!refresh) throw new Error("Zoho is not connected yet (no refresh token). Go to Settings → Connect Zoho Projects.");
  const body = new URLSearchParams({
    refresh_token: refresh,
    client_id: config.zoho.clientId,
    client_secret: config.zoho.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${config.zoho.accountsUrl}/oauth/v2/token`, { method: "POST", body });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) throw new Error(`Zoho token refresh failed: ${json.error ?? res.status}`);
  cached = { access: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.access;
}

// Simple sliding-window limiter so a full sync never trips Zoho's 2-minute limit.
const calls: number[] = [];
async function throttle() {
  const windowMs = 120_000;
  for (;;) {
    const now = Date.now();
    while (calls.length && calls[0] < now - windowMs) calls.shift();
    if (calls.length < config.zoho.rateLimitPer2Min) {
      calls.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, calls[0] + windowMs - now + 50));
  }
}

export async function zget<T = any>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  await throttle();
  const url = new URL(`${config.zoho.apiBase}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}` } });
  if (res.status === 204) return {} as T;
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After") ?? 60) * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 5 * 60_000)));
    return zget<T>(path, params);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Zoho GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Fetch every page of a list endpoint. `key` is the array property name in the response. */
export async function zgetAll(path: string, key: string, params: Record<string, string | number> = {}): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page < 200; page++) {
    const json = await zget<any>(path, { ...params, page, per_page: 100 });
    const items: any[] = json?.[key] ?? [];
    out.push(...items);
    const info = json?.page_info;
    const more = info ? Boolean(info.has_next_page) : items.length === 100;
    if (!more || items.length === 0) break;
  }
  return out;
}

export async function resolvePortalId(): Promise<string> {
  if (config.zoho.portalId) return config.zoho.portalId;
  const saved = await getState("zoho.portal_id");
  if (saved) return saved;
  const json = await zget<any>("/api/v3/portals");
  const portals: any[] = Array.isArray(json) ? json : json?.portals ?? [];
  const want = config.zoho.portalName.toLowerCase();
  const p =
    portals.find((x) => String(x.portal_name ?? x.name ?? "").toLowerCase() === want) ??
    portals.find((x) => String(x.name ?? "").toLowerCase().includes(want)) ??
    portals[0];
  if (!p) throw new Error("No Zoho Projects portal found for this account");
  const id = String(p.id ?? p.id_string ?? p.portal_id);
  await setState("zoho.portal_id", id);
  return id;
}

export function clearTokenCache() {
  cached = null;
}
