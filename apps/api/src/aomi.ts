import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

/**
 * Operator-console BFF for the deployed LiqSteward Aomi app.
 *
 * The browser never talks to the Aomi backend directly: this thin server
 * layer owns the backend URL, the app binding, and the thread lifecycle, so
 * the deployed console can later add manager authentication and API keys in
 * exactly one place. Wire protocol (all requests carry `X-Session-Id` /
 * `X-Thread-Id` headers holding the thread id):
 *
 *   POST {backend}/api/threads?app={app}          create thread bound to app
 *   POST {backend}/api/thread/chat?app=&message=  start an async agent turn
 *   GET  {backend}/api/thread/state?app=          poll messages + processing
 *   POST {backend}/api/thread/interrupt?app=      stop the running turn
 */

export type AomiConsoleOptions = {
  /** Aomi backend origin, e.g. https://api-staging.aomi.dev */
  backendUrl?: string;
  /** Deployed Aomi app name the console operates. */
  app?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
};

type ChatBody = { message?: string };

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_MESSAGE_LENGTH = 8000;

function upstreamHeaders(threadId: string): Record<string, string> {
  return { "X-Session-Id": threadId, "X-Thread-Id": threadId };
}

export function registerAomiConsole(app: FastifyInstance, options: AomiConsoleOptions = {}) {
  const backendUrl = (options.backendUrl ?? process.env.AOMI_BACKEND_URL ?? "https://api-staging.aomi.dev").replace(/\/+$/, "");
  const appName = options.app ?? process.env.AOMI_APP_NAME ?? "liqsteward";
  const fetchImpl = options.fetchImpl ?? fetch;

  let appStatusCache: { at: number; status: Record<string, unknown> } | null = null;
  // A community-hosted app resolves by its stable application row id, not by
  // name (name resolution only covers officially-sourced apps), so every
  // thread call carries `application_id` once the listing has supplied it.
  let applicationId: number | null = null;

  async function proxy(path: string, threadId: string, init?: RequestInit) {
    const response = await fetchImpl(`${backendUrl}${path}`, {
      ...init,
      headers: { ...upstreamHeaders(threadId), ...(init?.headers as Record<string, string> | undefined) },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: "Aomi backend returned a non-JSON response", raw: text.slice(0, 500) };
    }
    return { status: response.status, body };
  }

  async function refreshAppStatus(): Promise<Record<string, unknown>> {
    const now = Date.now();
    if (appStatusCache && now - appStatusCache.at <= 60_000) return appStatusCache.status;
    let status: Record<string, unknown> = { reachable: false, deployed: false, active: false, artifactReady: false };
    try {
      const probe = await proxy("/api/thread/apps", randomUUID());
      if (probe.status === 200 && Array.isArray(probe.body)) {
        const entry = probe.body.find(
          (item) => typeof item === "object" && item !== null && (item as { name?: string }).name === appName,
        ) as { is_active?: boolean; artifact_ready?: boolean; application_id?: number } | undefined;
        if (typeof entry?.application_id === "number") applicationId = entry.application_id;
        status = {
          reachable: true,
          deployed: Boolean(entry),
          active: entry?.is_active ?? false,
          artifactReady: entry?.artifact_ready ?? false,
          applicationId: entry?.application_id ?? null,
        };
      }
    } catch {
      // Backend unreachable: report it rather than failing the console shell.
    }
    appStatusCache = { at: now, status };
    return status;
  }

  async function appQuery(extra: Record<string, string> = {}): Promise<URLSearchParams> {
    if (applicationId === null) await refreshAppStatus();
    const query = new URLSearchParams({ app: appName, ...extra });
    if (applicationId !== null) query.set("application_id", String(applicationId));
    return query;
  }

  app.get("/api/console/config", async () => ({
    app: appName,
    backendUrl,
    appStatus: await refreshAppStatus(),
  }));

  app.post("/api/console/threads", async (_request, reply) => {
    const threadId = randomUUID();
    const upstream = await proxy(`/api/threads?${await appQuery()}`, threadId, { method: "POST" });
    if (upstream.status !== 200) {
      return reply.code(502).send({ error: "failed to create Aomi thread", upstream: upstream.body });
    }
    return { threadId, app: appName, upstream: upstream.body };
  });

  app.post<{ Params: { threadId: string }; Body: ChatBody }>(
    "/api/console/threads/:threadId/messages",
    async (request, reply) => {
      const { threadId } = request.params;
      if (!THREAD_ID_PATTERN.test(threadId)) {
        return reply.code(400).send({ error: "threadId must be a lowercase UUID" });
      }
      const message = request.body?.message?.trim();
      if (!message) return reply.code(400).send({ error: "message is required" });
      if (message.length > MAX_MESSAGE_LENGTH) {
        return reply.code(400).send({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
      }
      const upstream = await proxy(`/api/thread/chat?${await appQuery({ message })}`, threadId, { method: "POST" });
      return reply.code(upstream.status === 200 ? 200 : 502).send(upstream.body);
    },
  );

  app.get<{ Params: { threadId: string } }>("/api/console/threads/:threadId/state", async (request, reply) => {
    const { threadId } = request.params;
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return reply.code(400).send({ error: "threadId must be a lowercase UUID" });
    }
    const upstream = await proxy(`/api/thread/state?${await appQuery()}`, threadId);
    return reply.code(upstream.status === 200 ? 200 : 502).send(upstream.body);
  });

  app.post<{ Params: { threadId: string } }>("/api/console/threads/:threadId/interrupt", async (request, reply) => {
    const { threadId } = request.params;
    if (!THREAD_ID_PATTERN.test(threadId)) {
      return reply.code(400).send({ error: "threadId must be a lowercase UUID" });
    }
    const upstream = await proxy(`/api/thread/interrupt?${await appQuery()}`, threadId, {
      method: "POST",
    });
    return reply.code(upstream.status === 200 ? 200 : 502).send(upstream.body);
  });
}
