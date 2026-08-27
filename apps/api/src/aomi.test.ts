import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const BACKEND = "https://aomi.test";

type Call = { url: string; method: string; headers: Record<string, string> };

function stubbedAomi(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, method: init?.method ?? "GET", headers });
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
      appStatus: { reachable: true, deployed: true, active: true, artifactReady: true, applicationId: 7 },
    });
    await app.close();
  });

  it("creates a thread bound to the configured app and forwards chat + state", async () => {
    const { calls, fetchImpl } = stubbedAomi({
      "/api/thread/apps": {
        body: [{ name: "liqsteward", application_id: 7, is_active: true, artifact_ready: true }],
      },
      "/api/threads": { body: { thread_id: "ignored-upstream-id", title: "New Chat" } },
      "/api/thread/chat": { body: { messages: [], is_processing: true } },
      "/api/thread/state": {
        body: { messages: [{ sender: "agent", content: "pinned" }], is_processing: false },
      },
    });
    const app = buildApp({ aomi: { backendUrl: BACKEND, app: "liqsteward", fetchImpl } });

    const created = await app.inject({ method: "POST", url: "/api/console/threads" });
    expect(created.statusCode).toBe(200);
    const { threadId } = created.json();
    expect(threadId).toMatch(/^[0-9a-f-]{36}$/);
    const threadCall = calls.find((call) => new URL(call.url).pathname === "/api/threads");
    expect(threadCall).toBeDefined();
    // The stable application row id rides along: community-hosted apps do not
    // resolve by bare name on the backend.
    expect(new URL(threadCall!.url).searchParams.get("application_id")).toBe("7");
    expect(threadCall!.headers["x-session-id"]).toBe(threadId);

    const chat = await app.inject({
      method: "POST",
      url: `/api/console/threads/${threadId}/messages`,
      payload: { message: "Inspect the vault." },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toEqual({ messages: [], is_processing: true });
    const chatCall = new URL(calls.find((call) => new URL(call.url).pathname === "/api/thread/chat")!.url);
    expect(chatCall.searchParams.get("app")).toBe("liqsteward");
    expect(chatCall.searchParams.get("application_id")).toBe("7");
    expect(chatCall.searchParams.get("message")).toBe("Inspect the vault.");

    const state = await app.inject({ method: "GET", url: `/api/console/threads/${threadId}/state` });
    expect(state.statusCode).toBe(200);
    expect(state.json().messages[0].content).toBe("pinned");
    await app.close();
  });

  it("rejects malformed thread ids and empty messages without calling upstream", async () => {
    const { calls, fetchImpl } = stubbedAomi({});
    const app = buildApp({ aomi: { backendUrl: BACKEND, fetchImpl } });

    const badThread = await app.inject({ method: "GET", url: "/api/console/threads/not-a-uuid/state" });
    expect(badThread.statusCode).toBe(400);

    const emptyMessage = await app.inject({
      method: "POST",
      url: "/api/console/threads/6f0a2c3e-1d2b-4c5d-8e9f-0a1b2c3d4e5f/messages",
      payload: { message: "   " },
    });
    expect(emptyMessage.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("surfaces upstream failures as 502 with the upstream body", async () => {
    const { fetchImpl } = stubbedAomi({ "/api/threads": { status: 503, body: { error: "cold app" } } });
    const app = buildApp({ aomi: { backendUrl: BACKEND, fetchImpl } });
    const created = await app.inject({ method: "POST", url: "/api/console/threads" });
    expect(created.statusCode).toBe(502);
    expect(created.json().upstream).toEqual({ error: "cold app" });
    await app.close();
  });
});
