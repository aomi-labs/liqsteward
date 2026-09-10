import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const BACKEND = "https://api.aomi.test";
const PORTAL = "https://chat.aomi.test";

describe("Aomi console discovery", () => {
  it("resolves exact app identities and directs the widget to the public portal", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([
      { name: "liqsteward", application_id: 7, is_active: true, artifact_ready: true },
      { name: "nav-oracle", application_id: 9, is_active: true, artifact_ready: false },
    ])));
    const app = buildApp({ aomi: { backendUrl: BACKEND, portalUrl: `${PORTAL}/`, fetchImpl } });
    const nav = await app.inject({ method: "GET", url: "/api/console/config?app=nav-oracle" });
    expect(nav.json()).toEqual({
      app: "nav-oracle", apps: ["nav-oracle", "liqsteward"], backendUrl: BACKEND,
      runtimeUrl: PORTAL,
      appStatus: { reachable: true, deployed: true, active: true, artifactReady: false, applicationId: 9 },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BACKEND}/api/thread/apps`);
    const legacy = await app.inject({ method: "GET", url: "/api/console/config?app=liqsteward" });
    expect(legacy.json().appStatus.applicationId).toBe(7);
    expect(legacy.json().runtimeUrl).toBe(PORTAL);
    expect((await app.inject({ method: "GET", url: "/api/console/config?app=other" })).statusCode).toBe(404);
    await app.close();
  });

  it("reports discovery failure without inventing an app identity", async () => {
    const app = buildApp({ aomi: { fetchImpl: async () => new Response("", { status: 503 }) } });
    const response = await app.inject({ method: "GET", url: "/api/console/config?app=nav-oracle" });
    expect(response.json().appStatus).toMatchObject({ reachable: false, deployed: false, applicationId: null });
    await app.close();
  });

  it("does not relay legacy chat, account, or secret requests", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const app = buildApp({ aomi: { fetchImpl } });
    for (const path of ["api/thread/chat", "api/account/payment/byok", "api/thread/secrets", "v1/agent/chat/id/actions/id/result"]) {
      const response = await app.inject({ method: "POST", url: `/api/aomi/nav-oracle/${path}` });
      expect(response.statusCode).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires a visitor bearer and matching embedding origin before relaying", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const app = buildApp({ aomi: { fetchImpl } });
    const url = "/api/aomi/nav-oracle/v1/agent/chat";
    expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, payload: {}, headers: {
      authorization: "Bearer visitor-test", "x-steward-origin": "https://foreign.test",
    } })).statusCode).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it("relays only visitor credentials and pins turns to the deployed app", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(String(input).endsWith("/api/thread/apps")
        ? [{ name: "nav-oracle", application_id: 9 }]
        : { events: [] }), { headers: { "content-type": "application/json", "set-cookie": "do-not-forward" } });
    };
    const app = buildApp({ aomi: { backendUrl: BACKEND, portalUrl: PORTAL, fetchImpl } });
    const response = await app.inject({ method: "POST", url: "/api/aomi/nav-oracle/v1/agent/chat?application_id=777", payload: {
      sessionId: "thread-1", message: "Value the vault", applicationId: 777, app: "other", mode: "auto",
    }, headers: {
      host: "steward.test", origin: "https://steward.test", "x-steward-origin": "https://steward.test",
      authorization: "Bearer visitor-test", cookie: "private-cookie", "idempotency-key": "test-turn",
    } });
    expect(response.statusCode).toBe(200);
    const call = calls.at(-1)!;
    expect(call.url).toBe(`${PORTAL}/v1/agent/chat`);
    expect(JSON.parse(call.init!.body as string)).toMatchObject({ applicationId: 9, app: "nav-oracle", mode: "direct" });
    const headers = new Headers(call.init!.headers);
    expect(headers.get("authorization")).toBe("Bearer visitor-test");
    expect(headers.get("origin")).toBe("https://steward.test");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-steward-origin")).toBeNull();
    expect(headers.get("idempotency-key")).toBe("test-turn");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(call.init!.redirect).toBe("manual");
    await app.close();
  });
});
