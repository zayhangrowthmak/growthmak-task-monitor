// Zoho Cliq channel alerts. Uses the channel's incoming endpoint with a webhook token
// (Cliq → profile → Bots & Tools → Webhook tokens), so no extra OAuth is needed.
import { config } from "./config";

export const cliqConfigured = () => Boolean(config.cliq.channel && config.cliq.webhookToken);

export async function postToCliq(text: string, card?: { title: string; theme?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!cliqConfigured()) return { ok: false, error: "Cliq not configured (CLIQ_CHANNEL / CLIQ_WEBHOOK_TOKEN)" };
  const url = new URL(`${config.cliq.apiBase}/api/v2/channelsbyname/${encodeURIComponent(config.cliq.channel)}/message`);
  url.searchParams.set("zapikey", config.cliq.webhookToken);
  if (config.cliq.botName) url.searchParams.set("bot_unique_name", config.cliq.botName);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card ? { text, card: { title: card.title, theme: card.theme ?? "modern-inline" } } : { text }),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
