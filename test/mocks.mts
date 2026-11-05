// Mock Zoho Accounts + Zoho Projects V3 + Zoho Cliq, so the end-to-end suite
// never touches the real services. Task dates are relative to "now" so the
// confidence rules give the same answers whenever the suite runs.
import http from "node:http";
import type { AddressInfo } from "node:net";

const DAY = 86_400_000;
const isoDate = (offsetDays: number) => {
  const d = new Date(Date.now() + 330 * 60_000 + offsetDays * DAY); // IST calendar date
  return d.toISOString().slice(0, 10);
};

export type Mock = {
  url: string;
  cliqPosts: string[];
  requests: string[];
  setTaskStatus: (id: string, status: { name: string; is_closed_type: boolean }) => void;
  close: () => Promise<void>;
};

export async function startMock(): Promise<Mock> {
  const cliqPosts: string[] = [];
  const requests: string[] = [];
  const statusOverride = new Map<string, { name: string; is_closed_type: boolean }>();

  const owner = (name: string, email: string, zpuid: string) => ({ owners_and_work: { owners: [{ zpuid, name, email }] } });
  const base = (id: string, extra: Record<string, unknown>) => ({
    id,
    prefix: `EUR-T${id}`,
    name: `Task ${id}`,
    description: "<p>Write the <b>blog</b>&nbsp;post</p>",
    status: statusOverride.get(id) ?? { name: "In Progress", is_closed_type: false, color: "#2a78d6" },
    start_date: isoDate(-6),
    end_date: isoDate(10),
    completion_percentage: 30,
    created_by: { name: "Aakash", email: "aakash@growthmaksolutions.com" },
    created_time: new Date(Date.now() - 8 * DAY).toISOString(),
    last_modified_time: new Date(Date.now() - DAY).toISOString(),
    tags: [],
    log_hours: { billable_hours: "2:30", non_billable_hours: "1:00" },
    ...owner("Sandeep", "Sandeep@GrowthmakSolutions.com", "z1"),
    ...extra,
    ...(statusOverride.get(id) ? { status: statusOverride.get(id) } : {}),
  });

  const tasks = () => [
    base("101", { tags: [{ name: "client:AdinNYC" }] }), // on track, client-tagged
    base("102", { status: { name: "Blocked - waiting on client", is_closed_type: false }, ...owner("Vahid", "vahid@growthmaksolutions.com", "z2") }),
    base("103", { end_date: isoDate(-3), completion_percentage: 60 }), // overdue
    base("104", { name: "Google &amp; Meta Ads", status: { name: "QA Review", is_closed_type: false }, end_date: isoDate(1) }), // review, due tomorrow
    base("107", { owners_and_work: { owners: [{ zpuid: "z0", name: "Unassigned User", email: "Unassigned User" }] } }), // placeholder owner
    base("105", { status: { name: "Completed", is_closed_type: true }, end_date: isoDate(-2), completed_time: new Date(Date.now() - 3 * DAY).toISOString() }),
    base("106", { status: { name: "Cancelled", is_closed_type: true } }), // must be excluded
  ];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://mock");
      requests.push(`${req.method} ${u.pathname}`);
      const json = (o: unknown, code = 200) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };
      if (u.pathname === "/oauth/v2/token") return json({ access_token: "mock-access", expires_in: 3600 });
      if (u.pathname === "/api/v3/portals") return json([{ id: 999, portal_name: "growthmak" }]);
      if (u.pathname === "/api/v3/portal/999/projects")
        return json({
          projects: [
            { id: 11, name: "EUR - Eurofins", status: { name: "Active" }, group: { name: "Growthmak Team" }, owner: { name: "Aakash", email: "aakash@growthmaksolutions.com" }, custom_fields: [{ label_name: "Client Type", value: "Client" }] },
            { id: 12, name: "GM - Growthmak", status: { name: "Active" }, custom_fields: [{ label_name: "Client Type", value: "Internal" }] },
            { id: 13, name: "Old Project", status: { name: "Archived" } },
          ],
          page_info: { has_next_page: false },
        });
      if (u.pathname === "/api/v3/portal/999/projects/11/tasks") {
        const all = tasks();
        const page = Number(u.searchParams.get("page") ?? 1);
        // two pages, to exercise pagination
        return json({ tasks: page === 1 ? all.slice(0, 3) : all.slice(3), page_info: { has_next_page: page === 1 } });
      }
      if (u.pathname === "/api/v3/portal/999/projects/12/tasks") return json({ tasks: [], page_info: { has_next_page: false } });
      const one = u.pathname.match(/^\/api\/v3\/portal\/999\/projects\/11\/tasks\/(\d+)$/);
      if (one) {
        const t = tasks().find((x) => x.id === one[1]);
        return t ? json({ tasks: [t] }) : json({ error: "not found" }, 404);
      }
      if (u.pathname.startsWith("/api/v2/channelsbyname/")) {
        if (u.searchParams.get("zapikey") !== "mock-cliq-token") return json({ message: "bad token" }, 401);
        cliqPosts.push(JSON.parse(body || "{}").text ?? "");
        return json({});
      }
      json({ error: `mock has no ${u.pathname}` }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    cliqPosts,
    requests,
    setTaskStatus: (id, status) => statusOverride.set(id, status),
    close: () => new Promise((r) => server.close(() => r())),
  };
}
