import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

/**
 * Operator-console BFF for the LiqSteward Aomi apps.
 *
 * The browser never talks to the Aomi backend directly. This layer provides
 * deployment status plus a same-origin, streaming relay for the native
 * widget, one path prefix per app (`/api/aomi/<app>/…`). The relay owns the
 * app binding and forwards only explicit runtime paths and headers, leaving
 * account, secret, signing, and broadcast surfaces inaccessible from the
 * frontend.
 */

export type AomiConsoleOptions = {
  /** Aomi backend origin, e.g. https://api-staging.aomi.dev */
  backendUrl?: string;
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

const WIDGET_RUNTIME_PREFIX = "/api/aomi";
const WIDGET_RUNTIME_PATH = /^(?:\/api\/thread\/(?:apps|chat|events|interrupt|model|models|state|updates)|\/api\/threads(?:\/[^/]+(?:\/(?:archive|unarchive))?)?|\/api\/exec\/simulate)$/;
const WIDGET_DISCOVERY_PATHS = new Set(["/api/thread/apps", "/api/thread/models"]);
const WIDGET_RUNTIME_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const WIDGET_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "x-session-id",
  "x-thread-id",
  "aomi-app-key",
  "last-event-id",
] as const;
const WIDGET_RESPONSE_HEADERS = ["content-type", "cache-control", "x-request-id"] as const;
const APP_NAME = /^[a-z0-9][a-z0-9_-]*$/;

function upstreamHeaders(threadId: string): Record<string, string> {
  return { "X-Session-Id": threadId, "X-Thread-Id": threadId };
}

export function registerAomiConsole(app: FastifyInstance, options: AomiConsoleOptions = {}) {
  const backendUrl = (options.backendUrl ?? process.env.AOMI_BACKEND_URL ?? "https://api-staging.aomi.dev").replace(/\/+$/, "");
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
      runtimeUrl: `${WIDGET_RUNTIME_PREFIX}/${appName}`,
      appStatus: await refreshAppStatus(appName),
    };
  });

  // The native widget uses session headers and an SSE stream that browsers
  // cannot send directly to the public backend from an arbitrary site. Keep
  // the browser on this origin and proxy only the runtime surface the widget
  // needs. Credentials, cookies, arbitrary paths, and arbitrary headers never
  // cross this boundary.
  app.all<{ Params: { app: string; "*": string } }>(`${WIDGET_RUNTIME_PREFIX}/:app/*`, async (request, reply) => {
    const appName = resolveApp(request.params.app);
    if (!appName) return reply.code(404).send({ error: "unknown Aomi app", apps });
    const prefix = `${WIDGET_RUNTIME_PREFIX}/${appName}`;
    const upstreamPath = (request.raw.url ?? request.url).slice(prefix.length);
    const upstreamPathname = new URL(upstreamPath, "http://aomi.invalid").pathname;
    if (!WIDGET_RUNTIME_PATH.test(upstreamPathname) || !WIDGET_RUNTIME_METHODS.has(request.method)) {
      return reply.code(404).send({ error: "unsupported Aomi widget runtime route" });
    }

    const headers = new Headers();
    for (const name of WIDGET_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }

    let body: BodyInit | undefined;
    if (request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined) {
      body = typeof request.body === "string"
        ? request.body
        : Buffer.isBuffer(request.body)
          ? request.body.toString()
          : JSON.stringify(request.body);
    }

    const upstreamUrl = new URL(upstreamPath, `${backendUrl}/`);
    const needsAppScope = upstreamPathname.startsWith("/api/threads")
      || (upstreamPathname.startsWith("/api/thread/") && !WIDGET_DISCOVERY_PATHS.has(upstreamPathname));
    if (needsAppScope) {
      const status = await refreshAppStatus(appName);
      if (status.applicationId === null) {
        return reply.code(503).send({ error: `${appName} application identity is unavailable` });
      }
      upstreamUrl.searchParams.set("app", appName);
      upstreamUrl.searchParams.set("application_id", String(status.applicationId));
    }

    const upstream = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers,
      body,
    });
    reply.code(upstream.status);
    for (const name of WIDGET_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) reply.header(name, value);
    }
    if (!upstream.body) return reply.send();
    return reply.send(Readable.fromWeb(
      upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    ));
  });
}
