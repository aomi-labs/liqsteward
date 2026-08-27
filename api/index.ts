import { buildApp } from "../apps/api/src/app.js";

type VercelRequest = {
  query: Record<string, string | string[] | undefined>;
  url?: string;
};

type VercelResponse = unknown;

const app = buildApp({
  rpcUrl: process.env.ETHEREUM_RPC_URL,
  webOrigin: "https://liqsteward.app",
});
const ready = app.ready();

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ready;

  const rawPath = request.query.path;
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "health";
  const incoming = new URL(request.url ?? "/api", "https://liqsteward.app");
  incoming.pathname = `/api/${path}`;
  incoming.searchParams.delete("path");
  request.url = `${incoming.pathname}${incoming.search}`;

  app.server.emit("request", request, response);
}
