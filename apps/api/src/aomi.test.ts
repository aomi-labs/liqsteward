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
    for (const path of ["api/thread/chat", "api/account/payment/byok", "api/thread/secrets", "v1/agent/chat"]) {
      const response = await app.inject({ method: "POST", url: `/api/aomi/nav-oracle/${path}` });
      expect(response.statusCode).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });
});
