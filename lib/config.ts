// Central configuration. Everything comes from environment variables so the
// same build runs in demo mode locally and against Zoho on Railway.

const list = (v?: string) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
  demoMode: process.env.DEMO_MODE === "true",

  // People who get the manager / super-admin view. More can be promoted in Settings.
  adminEmails: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  // Optional: only allow sign-in from this email domain (e.g. growthmaksolutions.com)
  allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase(),

  zoho: {
    clientId: process.env.ZOHO_CLIENT_ID ?? "",
    clientSecret: process.env.ZOHO_CLIENT_SECRET ?? "",
    accountsUrl: (process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.in").replace(/\/$/, ""),
    apiBase: (process.env.ZOHO_PROJECTS_API ?? "https://projectsapi.zoho.in").replace(/\/$/, ""),
    webBase: (process.env.ZOHO_PROJECTS_WEB ?? "https://projects.zoho.in").replace(/\/$/, ""),
    portalName: process.env.ZOHO_PORTAL_NAME ?? "growthmak",
    portalId: process.env.ZOHO_PORTAL_ID ?? "",
    // Refresh token for the sync account. Can also be set from Settings → Connect Zoho.
    refreshToken: process.env.ZOHO_REFRESH_TOKEN ?? "",
    syncScopes:
      process.env.ZOHO_SYNC_SCOPES ??
      "ZohoProjects.portals.READ,ZohoProjects.projects.READ,ZohoProjects.tasks.READ,ZohoProjects.users.READ,ZohoProjects.timesheets.READ",
    loginScopes: process.env.ZOHO_LOGIN_SCOPES ?? "AaaServer.profile.Read",
    webhookSecret: process.env.ZOHO_WEBHOOK_SECRET ?? "",
    // Project custom-field labels to read the client name/type from (case-insensitive)
    clientFieldLabels: list(process.env.ZOHO_CLIENT_FIELD_LABELS || "Client,Client Name"),
    clientTypeFieldLabels: list(process.env.ZOHO_CLIENT_TYPE_FIELD_LABELS || "Client Type,Type,Category"),
    // Only these Zoho project statuses are synced (case-insensitive). Empty = all non-archived.
    activeProjectStatuses: list(process.env.ZOHO_ACTIVE_PROJECT_STATUSES),
    // Requests per 2-minute window we allow ourselves (Zoho limit is 100–200).
    rateLimitPer2Min: Number(process.env.ZOHO_RATE_LIMIT ?? 90),
  },

  // Projects/clients treated as internal when Zoho doesn't say otherwise
  internalNames: list(process.env.INTERNAL_CLIENT_NAMES || "Growthmak,GrowthOS,Internal").map((s) => s.toLowerCase()),

  cliq: {
    // Zoho Cliq channel unique name + webhook token (zapikey) from Cliq → Bots & Tools → Webhook tokens
    apiBase: (process.env.CLIQ_API_BASE ?? "https://cliq.zoho.in").replace(/\/$/, ""),
    channel: process.env.CLIQ_CHANNEL ?? "",
    webhookToken: process.env.CLIQ_WEBHOOK_TOKEN ?? "",
    botName: process.env.CLIQ_BOT_NAME ?? "",
  },

  jobs: {
    enabled: process.env.RUN_JOBS !== "false",
    syncOnBoot: process.env.SYNC_ON_BOOT !== "false",
    syncIntervalMin: Number(process.env.SYNC_INTERVAL_MIN ?? 15),
    confidenceIntervalMin: Number(process.env.CONFIDENCE_INTERVAL_MIN ?? 30),
    cronSecret: process.env.CRON_SECRET ?? "",
  },

  // JSON map of exact Zoho status name → bucket, e.g. {"Waiting on client":"BLOCKED"}
  statusMap: (() => {
    try {
      return JSON.parse(process.env.STATUS_MAP ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  })(),
};

export const zohoConfigured = () => Boolean(config.zoho.clientId && config.zoho.clientSecret);
