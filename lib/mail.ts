// Send email through the Zoho Mail API (HTTPS). The mailbox that sends is whoever
// clicked Settings → Connect Zoho Mail; feedback goes to FEEDBACK_EMAIL.
import { config } from "./config";
import { getState, setState } from "./db";

let cached: { access: string; expiresAt: number } | null = null;

export async function mailRefreshToken(): Promise<string> {
  return config.mail.refreshToken || (await getState("zohomail.refresh_token")) || "";
}

export async function mailConnected(): Promise<boolean> {
  return Boolean(await mailRefreshToken());
}

export function clearMailCache() {
  cached = null;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.access;
  const refresh = await mailRefreshToken();
  if (!refresh) throw new Error("Zoho Mail is not connected (Settings → Connect Zoho Mail)");
  const res = await fetch(`${config.zoho.accountsUrl}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({ refresh_token: refresh, client_id: config.zoho.clientId, client_secret: config.zoho.clientSecret, grant_type: "refresh_token" }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) throw new Error(`Zoho Mail token refresh failed: ${json.error ?? res.status}`);
  cached = { access: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.access;
}

async function mailFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${config.mail.apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zoho Mail ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** The sending mailbox: account id + address, cached after the first lookup. */
export async function mailAccount(): Promise<{ accountId: string; fromAddress: string }> {
  const saved = await getState("zohomail.account");
  if (saved) return JSON.parse(saved);
  const json = await mailFetch("/api/accounts");
  const a = (json?.data ?? [])[0];
  if (!a) throw new Error("No Zoho Mail account found for the connected user");
  const acct = { accountId: String(a.accountId), fromAddress: String(a.primaryEmailAddress ?? a.mailboxAddress ?? a.emailAddress?.[0]?.mailId ?? "") };
  await setState("zohomail.account", JSON.stringify(acct));
  return acct;
}

export async function sendMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const { accountId, fromAddress } = await mailAccount();
  await mailFetch(`/api/accounts/${accountId}/messages`, {
    method: "POST",
    body: JSON.stringify({ fromAddress, toAddress: opts.to, subject: opts.subject, content: opts.html, mailFormat: "html" }),
  });
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
