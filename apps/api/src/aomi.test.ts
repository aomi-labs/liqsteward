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

describe("Aomi console BFF", () => {
  it("reports the deployed app status in config", async () => {
    const { fetchImpl } = stubbedAomi({
      "/api/thread/apps": {
        body: [
          { name: "other" },
          { name: "liqsteward", application_id: 7, is_active: true, artifact_ready: true },
        ],
      },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, app: "liqsteward", fetchImpl } });
    const response = await app.inject({ method: "GET", url: "/api/console/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      app: "liqsteward",
      backendUrl: BACKEND,
      runtimeUrl: "/api/aomi",
      appStatus: { reachable: true, deployed: true, active: true, artifactReady: true, applicationId: 7 },
    });
    await app.close();
  });

  it("refuses scoped widget requests when the application identity is unavailable", async () => {
    const { fetchImpl } = stubbedAomi({
      "/api/thread/apps": { status: 503, body: { error: "backend unavailable" } },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, fetchImpl } });
    const response = await app.inject({ method: "POST", url: "/api/aomi/api/threads" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "LiqSteward application identity is unavailable" });
    await app.close();
  });

  it("proxies the native widget runtime on the same origin", async () => {
    const { calls, fetchImpl } = stubbedAomi({
      "/api/thread/apps": { body: [{ name: "liqsteward", application_id: 7 }] },
      "/api/threads": { body: { thread_id: "thread-1", title: "New Chat" } },
      "/api/exec/simulate": { body: { success: true } },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, fetchImpl } });
    await app.inject({ method: "GET", url: "/api/console/config" });
    calls.length = 0;

    const apps = await app.inject({
      method: "GET",
      url: "/api/aomi/api/thread/apps?platform=community",
      headers: {
        "x-session-id": "session-1",
        "x-thread-id": "thread-1",
        "aomi-app-key": "app-key",
        authorization: "Bearer must-not-forward",
      },
    });
    expect(apps.statusCode).toBe(200);
    expect(apps.json()[0].name).toBe("liqsteward");
    expect(calls[0]?.url).toBe(`${BACKEND}/api/thread/apps?platform=community`);
    expect(calls[0]?.headers).toMatchObject({
      "x-session-id": "session-1",
      "x-thread-id": "thread-1",
      "aomi-app-key": "app-key",
    });
    expect(calls[0]?.headers.authorization).toBeUndefined();

    const thread = await app.inject({
      method: "POST",
      url: "/api/aomi/api/threads?app=default&application_id=1",
      headers: { "x-session-id": "thread-1", "x-thread-id": "thread-1" },
    });
    expect(thread.statusCode).toBe(200);
    const threadUrl = new URL(calls[1]!.url);
    expect(threadUrl.pathname).toBe("/api/threads");
    expect(threadUrl.searchParams.get("app")).toBe("liqsteward");
    expect(threadUrl.searchParams.get("application_id")).toBe("7");

    const simulation = await app.inject({
      method: "POST",
      url: "/api/aomi/api/exec/simulate",
      headers: { "content-type": "application/json", "x-session-id": "session-1" },
      payload: { transactions: [{ to: "0x1234" }] },
    });
    expect(simulation.statusCode).toBe(200);
    expect(calls[2]?.body).toBe(JSON.stringify({ transactions: [{ to: "0x1234" }] }));
    await app.close();
  });

  it("rejects paths outside the native widget runtime surface", async () => {
    const { calls, fetchImpl } = stubbedAomi({});
    const app = buildApp({ aomi: { backendUrl: BACKEND, fetchImpl } });
    const account = await app.inject({ method: "GET", url: "/api/aomi/api/account/payment/byok" });
    const secret = await app.inject({ method: "GET", url: "/api/aomi/api/thread/secrets" });
    expect(account.statusCode).toBe(404);
    expect(secret.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
    await app.close();
  });
});
