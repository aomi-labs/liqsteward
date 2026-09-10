import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerNav } from "./routes.js";
import type { NavStore } from "./store.js";

describe("NAV write authorization", () => {
  for (const [method, url] of [["POST", "/api/nav/policies"], ["PATCH", "/api/nav/breaks/example"]] as const) {
    it(`${method} ${url} rejects anonymous and invalid credentials before touching storage`, async () => {
      const store = new Proxy({}, { get: () => { throw new Error("unauthorized storage access"); } }) as NavStore;
      const app = Fastify();
      registerNav(app, { store, serviceToken: "test-service-token" });
      try {
        for (const headers of [{}, { authorization: "Bearer wrong" }]) {
          const response = await app.inject({ method, url, headers, payload: {} });
          expect(response.statusCode).toBe(401);
        }
        const missingSession = await app.inject({ method, url, headers: { authorization: "Bearer test-service-token" }, payload: {} });
        expect(missingSession.statusCode).toBe(400);
      } finally { await app.close(); }
    });
  }

  it("refuses authenticated break updates from another session", async () => {
    const updateBreak = vi.fn();
    const store = {
      breakById: async () => ({ dag_id: "dag-one" }),
      dag: async () => ({ aomi_session_id: "owner" }),
      updateBreak,
    } as unknown as NavStore;
    const app = Fastify();
    registerNav(app, { store, serviceToken: "test-service-token" });
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/nav/breaks/example", headers: { authorization: "Bearer test-service-token", "x-aomi-session": "other" }, payload: { status: "resolved" } });
      expect(response.statusCode).toBe(403);
      expect(updateBreak).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
