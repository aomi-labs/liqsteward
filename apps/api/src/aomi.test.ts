import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const BACKEND = "https://aomi.test";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };

function stubbedAomi(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const { pathname } = new URL(url);
    const match = responses[pathname];
    if (!match) return new Response(JSON.stringify({ error: "unexpected path" }), { status: 404 });
    return new Response(JSON.stringify(match.body), {
      status: match.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const APPS = ["nav-oracle", "liqsteward"];

describe("Aomi console BFF", () => {
  it("reports each app's deployed status under its own prefix", async () => {
    const { fetchImpl } = stubbedAomi({
      "/api/thread/apps": {
        body: [
          { name: "liqsteward", application_id: 7, is_active: true, artifact_ready: true },
          { name: "nav-oracle", application_id: 9, is_active: true, artifact_ready: false },
        ],
      },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, apps: APPS, fetchImpl } });
    const nav = await app.inject({ method: "GET", url: "/api/console/config?app=nav-oracle" });
    expect(nav.statusCode).toBe(200);
    expect(nav.json()).toEqual({
      app: "nav-oracle",
      apps: APPS,
      backendUrl: BACKEND,
      runtimeUrl: "/api/aomi/nav-oracle",
      appStatus: { reachable: true, deployed: true, active: true, artifactReady: false, applicationId: 9 },
    });
    const legacy = await app.inject({ method: "GET", url: "/api/console/config?app=liqsteward" });
    expect(legacy.json().runtimeUrl).toBe("/api/aomi/liqsteward");
    expect(legacy.json().appStatus.applicationId).toBe(7);
    const unknown = await app.inject({ method: "GET", url: "/api/console/config?app=other" });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it("refuses scoped widget requests when the application identity is unavailable", async () => {
    const { fetchImpl } = stubbedAomi({
      "/api/thread/apps": { status: 503, body: { error: "backend unavailable" } },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, apps: APPS, fetchImpl } });
    const response = await app.inject({ method: "POST", url: "/api/aomi/nav-oracle/api/threads" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "nav-oracle application identity is unavailable" });
    await app.close();
  });

  it("proxies the native widget runtime on the same origin, scoped to the prefixed app", async () => {
    const { calls, fetchImpl } = stubbedAomi({
      "/api/thread/apps": { body: [{ name: "liqsteward", application_id: 7 }, { name: "nav-oracle", application_id: 9 }] },
      "/api/threads": { body: { thread_id: "thread-1", title: "New Chat" } },
      "/api/exec/simulate": { body: { success: true } },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, apps: APPS, fetchImpl } });
    await app.inject({ method: "GET", url: "/api/console/config?app=nav-oracle" });
    calls.length = 0;

    const apps = await app.inject({
      method: "GET",
      url: "/api/aomi/nav-oracle/api/thread/apps?platform=community",
      headers: {
        "x-session-id": "session-1",
        "x-thread-id": "thread-1",
        "aomi-app-key": "app-key",
        authorization: "Bearer must-not-forward",
      },
    });
    expect(apps.statusCode).toBe(200);
    expect(calls[0]?.url).toBe(`${BACKEND}/api/thread/apps?platform=community`);
    expect(calls[0]?.headers).toMatchObject({
      "x-session-id": "session-1",
      "x-thread-id": "thread-1",
      "aomi-app-key": "app-key",
    });
    expect(calls[0]?.headers.authorization).toBeUndefined();

    const thread = await app.inject({
      method: "POST",
      url: "/api/aomi/nav-oracle/api/threads?app=default&application_id=1",
      headers: { "x-session-id": "thread-1", "x-thread-id": "thread-1" },
    });
    expect(thread.statusCode).toBe(200);
    const threadUrl = new URL(calls[1]!.url);
    expect(threadUrl.pathname).toBe("/api/threads");
    expect(threadUrl.searchParams.get("app")).toBe("nav-oracle");
    expect(threadUrl.searchParams.get("application_id")).toBe("9");

    const simulation = await app.inject({
      method: "POST",
      url: "/api/aomi/liqsteward/api/exec/simulate",
      headers: { "content-type": "application/json", "x-session-id": "session-1" },
      payload: { transactions: [{ to: "0x1234" }] },
    });
    expect(simulation.statusCode).toBe(200);
    expect(calls[2]?.body).toBe(JSON.stringify({ transactions: [{ to: "0x1234" }] }));
    await app.close();
  });

  it("rejects paths outside the native widget runtime surface and unknown apps", async () => {
    const { calls, fetchImpl } = stubbedAomi({});
    const app = buildApp({ aomi: { backendUrl: BACKEND, apps: APPS, fetchImpl } });
    const account = await app.inject({ method: "GET", url: "/api/aomi/nav-oracle/api/account/payment/byok" });
    const secret = await app.inject({ method: "GET", url: "/api/aomi/nav-oracle/api/thread/secrets" });
    const unknown = await app.inject({ method: "GET", url: "/api/aomi/other/api/thread/apps" });
    expect(account.statusCode).toBe(404);
    expect(secret.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
    await app.close();
  });
});
