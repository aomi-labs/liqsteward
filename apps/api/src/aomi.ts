import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

/**
 * Operator-console BFF for the LiqSteward Aomi apps.
 *
 * Reports deployment status. The widget uses the Aomi portal's public Agent
 * API with origin-bound guest authentication. A narrow Agent relay preserves
 * the visitor's credential; it never uses Steward's NAV service token.
 */

export type AomiConsoleOptions = {
  /** Aomi backend origin, e.g. https://api-staging.aomi.dev */
  backendUrl?: string;
  /** Portal origin providing guest authentication and the public Agent API. */
  portalUrl?: string;
  /** Deployed Aomi app names the console may operate. First is the default. */
  apps?: string[];
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
};

export type AppStatus = {
  reachable: boolean;
  deployed: boolean;
  active: boolean;
  artifactReady: boolean;
  applicationId: number | null;
};

const APP_NAME = /^[a-z0-9][a-z0-9_-]*$/;

function upstreamHeaders(threadId: string): Record<string, string> {
  return { "X-Session-Id": threadId, "X-Thread-Id": threadId };
}

export function registerAomiConsole(app: FastifyInstance, options: AomiConsoleOptions = {}) {
  const backendUrl = (options.backendUrl ?? process.env.AOMI_BACKEND_URL ?? "https://api-staging.aomi.dev").replace(/\/+$/, "");
  const portalUrl = (options.portalUrl ?? process.env.AOMI_PORTAL_URL ?? "https://chat-staging.aomi.dev").replace(/\/+$/, "");
  const apps = (options.apps ?? (process.env.AOMI_APPS ?? "nav-oracle,liqsteward").split(","))
    .map((name) => name.trim())
    .filter((name) => APP_NAME.test(name));
  const fetchImpl = options.fetchImpl ?? fetch;

  // A community-hosted app resolves by its stable application row id, not by
  // name (name resolution only covers officially-sourced apps), so every
  // thread call carries `application_id` once the listing has supplied it.
  const statusCache = new Map<string, { at: number; status: AppStatus }>();

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

  async function refreshAppStatus(appName: string): Promise<AppStatus> {
    const now = Date.now();
    const cached = statusCache.get(appName);
    if (cached && now - cached.at <= 60_000) return cached.status;
    let status: AppStatus = { reachable: false, deployed: false, active: false, artifactReady: false, applicationId: null };
    try {
      const probe = await proxy("/api/thread/apps", randomUUID());
      if (probe.status === 200 && Array.isArray(probe.body)) {
        const entry = probe.body.find(
          (item) => typeof item === "object" && item !== null && (item as { name?: string }).name === appName,
        ) as { is_active?: boolean; artifact_ready?: boolean; application_id?: number } | undefined;
        status = {
          reachable: true,
          deployed: Boolean(entry),
          active: entry?.is_active ?? false,
          artifactReady: entry?.artifact_ready ?? false,
          applicationId: typeof entry?.application_id === "number" ? entry.application_id : null,
        };
      }
    } catch {
      // Backend unreachable: report it rather than failing the console shell.
    }
    statusCache.set(appName, { at: now, status });
    return status;
  }

  function resolveApp(requested: string | undefined): string | null {
    if (!requested) return apps[0] ?? null;
    return apps.includes(requested) ? requested : null;
  }

  app.get<{ Querystring: { app?: string } }>("/api/console/config", async (request, reply) => {
    const appName = resolveApp(request.query.app);
    if (!appName) return reply.code(404).send({ error: "unknown Aomi app", apps });
    return {
      app: appName,
      apps,
      backendUrl,
      runtimeUrl: portalUrl,
      appStatus: await refreshAppStatus(appName),
    };
  });

  // The public portal currently has no CORS handler on /v1/agent. Authentication
  // still happens there: forward the visitor's bearer and actual embedding
  // origin, never cookies, service credentials, or signing/payment endpoints.
  app.all<{ Params: { app: string; "*": string } }>("/api/aomi/:app/v1/agent/*", async (request, reply) => {
    const appName = resolveApp(request.params.app);
    if (!appName) return reply.code(404).send({ error: "unknown Aomi app" });
    const path = `/v1/agent/${request.params["*"]}`;
    const allowed = request.method === "GET"
      ? /^\/v1\/agent\/(chat\/[a-zA-Z0-9_-]+|sessions(?:\/[a-zA-Z0-9_-]+)?)$/.test(path)
      : request.method === "POST"
        ? /^\/v1\/agent\/chat(?:\/[a-zA-Z0-9_-]+\/interrupt)?$/.test(path)
        : ["PATCH", "DELETE"].includes(request.method) && /^\/v1\/agent\/sessions\/[a-zA-Z0-9_-]+$/.test(path);
    if (!allowed) return reply.code(404).send({ error: "unsupported Agent route" });
    const bearer = request.headers.authorization;
    if (!bearer?.startsWith("Bearer ")) return reply.code(401).send({ error: "visitor authentication required" });
    const origin = request.headers["x-steward-origin"];
    try {
      const parsed = new URL(String(origin));
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      if (parsed.origin !== origin || parsed.host !== request.headers.host
        || (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
        || (request.headers.origin && request.headers.origin !== origin)) throw new Error("invalid origin");
    } catch {
      return reply.code(403).send({ error: "same-origin Agent request required" });
    }
    const headers = new Headers({ authorization: bearer, origin: String(origin) });
    for (const name of ["accept", "content-type", "idempotency-key", "x-session-id", "x-thread-id", "x-aomi-inference-funding"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    let body = request.body;
    if (request.method === "POST" && path === "/v1/agent/chat") {
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply.code(400).send({ error: "Agent turn must be an object" });
      const status = await refreshAppStatus(appName);
      if (!status.applicationId) return reply.code(503).send({ error: "application identity unavailable" });
      body = { ...body, mode: "direct", app: appName, applicationId: status.applicationId };
    }
    const upstream = new URL(`${portalUrl}${path}`);
    const query = new URL(request.url, "http://local.invalid").searchParams;
    for (const name of ["cursor", "wait", "limit"]) {
      if (request.method === "GET" && query.has(name)) upstream.searchParams.set(name, query.get(name)!);
    }
    const response = await fetchImpl(upstream, {
      method: request.method, headers, redirect: "manual", signal: AbortSignal.timeout(45_000),
      body: request.method === "GET" || body === undefined ? undefined : JSON.stringify(body),
    });
    reply.code(response.status).header("cache-control", "no-store");
    for (const name of ["content-type", "x-request-id", "retry-after"]) {
      const value = response.headers.get(name);
      if (value) reply.header(name, value);
    }
    return reply.send(await response.text());
  });
}
