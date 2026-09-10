import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

/**
 * Operator-console BFF for the LiqSteward Aomi apps.
 *
 * Reports deployment status. The widget uses the Aomi portal's public Agent
 * API and origin-bound guest authentication directly, not a legacy thread
 * relay or Steward's privileged NAV service token.
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

}
