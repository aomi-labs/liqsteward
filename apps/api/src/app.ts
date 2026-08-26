import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  buildEvidencePackage,
  historicalContainmentAction,
  historicalContainmentPolicy,
  safeBatch,
  summarizeIncident,
  transactionTimeline,
  usd0ppFixture,
  verifyTransaction,
} from "@risk-off/core";
import { isHash, type Hex } from "viem";

export function buildApp(options: { rpcUrl?: string; webOrigin?: string } = {}) {
  const app = Fastify({ logger: true });
  const fixture = usd0ppFixture();
  const rpcUrl = options.rpcUrl;

  app.register(cors, { origin: options.webOrigin ?? true });

  app.get("/api/health", async () => ({ ok: true, service: "risk-off-pilot", version: "0.1.0" }));

  app.get("/api/incidents/usd0pp", async () => ({
    fixture,
    summary: summarizeIncident(fixture),
    timeline: transactionTimeline(fixture),
  }));

  app.get("/api/incidents/usd0pp/evidence", async (_request, reply) => {
    reply.header("content-disposition", 'attachment; filename="usd0pp-evidence.json"');
    return buildEvidencePackage(fixture);
  });

  app.get("/api/incidents/usd0pp/containment", async () => {
    const action = historicalContainmentAction();
    return {
      policy: historicalContainmentPolicy(),
      action,
      safeBatch: safeBatch([action]),
      review: {
        requiredAuthority: "authorized MetaMorpho allocator",
        requiredApprovals: ["Gauntlet operator", "Safe signer quorum"],
        simulation: "required against an archive fork at the target incident block",
      },
    };
  });

  app.get<{ Params: { hash: string } }>("/api/transactions/:hash/verify", async (request, reply) => {
    const { hash } = request.params;
    if (!isHash(hash)) return reply.code(400).send({ error: "hash must be a 32-byte transaction hash" });
    const indexed = fixture.events.find((event) => event.hash.toLowerCase() === hash.toLowerCase());
    return verifyTransaction(hash as Hex, rpcUrl, indexed
      ? { allocatorCaller: indexed.caller, eventEmitter: fixture.vault.address, blockNumber: indexed.blockNumber }
      : undefined);
  });

  app.get<{ Params: { chainId: string; address: string } }>("/api/vaults/:chainId/:address", async (request, reply) => {
    const { chainId, address } = request.params;
    const upstream = `https://api.morpho.org/v0/vaults-v1/${encodeURIComponent(chainId)}:${encodeURIComponent(address)}`;
    const response = await fetch(upstream);
    if (!response.ok) return reply.code(response.status).send({ error: "Morpho vault lookup failed", upstream });
    const vault = await response.json();
    return { status: "live-public-data", fetchedAt: new Date().toISOString(), source: upstream, vault };
  });

  return app;
}
