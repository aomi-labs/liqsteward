import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  buildEvidencePackage,
  containmentAction,
  historicalContainmentAction,
  historicalContainmentPolicy,
  safeBatch,
  summarizeIncident,
  transactionTimeline,
  usd0ppFixture,
  verifyTransaction,
} from "@liqsteward/core";
import { isAddress, isHash, type Hex } from "viem";
import { registerAomiConsole, type AomiConsoleOptions } from "./aomi.js";
import { createNavDb, migrateNavDb } from "./nav/db.js";
import pilotPolicy from "./nav/fixtures/pilot-policy.json" with { type: "json" };
import { policyDigest, validatePolicy } from "./nav/policy.js";
import { registerNav } from "./nav/routes.js";
import { NavStore } from "./nav/store.js";

export type NavOptions = {
  /** Postgres connection string. Unset = `/api/nav/*` answers 503. */
  databaseUrl?: string;
  /** Bearer token the Aomi apps present on plugin routes. */
  serviceToken?: string;
  /** JSON-RPC used only to pin a block at `open_valuation`. */
  rpcUrl?: string;
  /** Injectable fetch for external price sources (tests). */
  fetchImpl?: typeof fetch;
  /** Skip running migrations at boot (tests own the schema). */
  skipMigrations?: boolean;
};

type ContainmentEncodingBody = {
  chain_id: number;
  vault: string;
  allocations: Array<{
    market: {
      loan_token: string;
      collateral_token: string;
      oracle: string;
      irm: string;
      lltv: string;
    };
    assets: string;
  }>;
  incident_id: string;
  confirmed: boolean;
};

type ExecutionVerificationBody = {
  transaction_hash?: string;
  chain_id: number;
  vault: string;
  risk_market_ids: string[];
  max_residual_assets: string;
  incident_id: string;
};

type MorphoAllocation = {
  supplyAssets: string;
  supplyAssetsUsd: number | null;
  market: { marketId: string; collateralAsset: { symbol: string } | null };
};

async function vaultAllocations(address: string, chainId: number) {
  const query = `query VaultResidual($address: String!, $chainId: Int!) {
    vaultByAddress(address: $address, chainId: $chainId) {
      address
      state {
        blockNumber
        timestamp
        allocation {
          supplyAssets
          supplyAssetsUsd
          market { marketId collateralAsset { symbol } }
        }
      }
    }
  }`;
  const response = await fetch("https://api.morpho.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { address, chainId } }),
  });
  if (!response.ok) throw new Error(`Morpho API returned ${response.status}`);
  const payload = await response.json() as {
    data?: { vaultByAddress?: { address: string; state?: { blockNumber: string; timestamp: string; allocation: MorphoAllocation[] } } };
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length) throw new Error(payload.errors.map(({ message }) => message).join("; "));
  const vault = payload.data?.vaultByAddress;
  if (!vault?.state) throw new Error("Morpho API returned no current vault state");
  return vault;
}

export function buildApp(
  options: { rpcUrl?: string; webOrigin?: string; aomi?: AomiConsoleOptions; nav?: NavOptions } = {},
) {
  const app = Fastify({ logger: true });
  const fixture = usd0ppFixture();
  const rpcUrl = options.rpcUrl;

  app.register(cors, { origin: options.webOrigin ?? true });

  registerAomiConsole(app, options.aomi);

  const nav = options.nav ?? {};
  if (nav.databaseUrl) {
    const { db, close } = createNavDb(nav.databaseUrl);
    const store = new NavStore(db);
    if (!nav.skipMigrations) {
      app.addHook("onReady", async () => {
        await migrateNavDb(db);
      });
    }
    // The pilot policy ships as a fixture so a fresh store can open a
    // valuation before anyone uploads through the dashboard. Uploads with the
    // same digest are no-ops, so re-seeding on every boot is idempotent.
    app.addHook("onReady", async () => {
      const parsed = validatePolicy(pilotPolicy);
      if (!parsed.ok) throw new Error(`pilot policy fixture invalid: ${parsed.error}`);
      const policy = parsed.policy;
      await store.insertPolicy({
        policy_id: policy.policy_id,
        vault: policy.scope.owned_accounts[0]!,
        digest: policyDigest(policy as unknown as Record<string, unknown>),
        body: policy as unknown as Record<string, unknown>,
        uploaded_by: policy.uploaded_by,
      });
    });
    app.addHook("onClose", async () => {
      await close();
    });
    registerNav(app, { store, serviceToken: nav.serviceToken, rpcUrl: nav.rpcUrl ?? rpcUrl, fetchImpl: nav.fetchImpl });
  } else {
    app.all("/api/nav/*", async (_request, reply) => reply.code(503).send({ error: "nav store is not configured (DATABASE_URL)" }));
  }

  app.get("/api/health", async () => ({ ok: true, service: "liqsteward", version: "0.2.0" }));

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

  app.post<{ Body: ContainmentEncodingBody }>("/api/containment/encode", async (request, reply) => {
    const body = request.body;
    if (!body || body.chain_id !== 1) {
      return reply.code(400).send({ error: "this pilot only supports Ethereum mainnet (chain_id 1)" });
    }
    if (!isAddress(body.vault)) {
      return reply.code(400).send({ error: "vault must be a 20-byte EVM address" });
    }
    if (!body.confirmed) {
      return reply.code(400).send({ error: "confirmed must be true" });
    }
    if (!Array.isArray(body.allocations) || body.allocations.length < 2) {
      return reply.code(400).send({ error: "allocations must contain source and destination targets" });
    }

    let allocations;
    try {
      allocations = body.allocations.map(({ market, assets }) => {
        const addresses = [market?.loan_token, market?.collateral_token, market?.oracle, market?.irm];
        if (addresses.some((address) => !address || !isAddress(address))) {
          throw new Error("every market address must be a 20-byte EVM address");
        }
        const lltv = BigInt(market.lltv);
        const targetAssets = BigInt(assets);
        if (lltv < 0n || targetAssets < 0n) throw new Error("lltv and assets must be non-negative");
        return {
          marketParams: {
            loanToken: market.loan_token as `0x${string}`,
            collateralToken: market.collateral_token as `0x${string}`,
            oracle: market.oracle as `0x${string}`,
            irm: market.irm as `0x${string}`,
            lltv,
          },
          assets: targetAssets,
        };
      });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "invalid allocation parameters",
      });
    }

    const description = `Morpho vault risk-off containment for incident ${body.incident_id}: apply ${allocations.length} manager-reviewed allocation targets`;
    const action = containmentAction(body.vault, allocations, description);
    return {
      to: action.to,
      chainId: body.chain_id,
      data: action.data,
      selector: action.data.slice(0, 10),
      description: action.description,
      value: action.value,
      kind: "vault_risk_off",
      protocol: "morpho",
      execution: "encoding-only; Aomi evm-core owns stage, simulation, approval and commit",
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

  app.post<{ Body: ExecutionVerificationBody }>("/api/executions/verify", async (request, reply) => {
    const body = request.body;
    if (!body || !body.transaction_hash || !isHash(body.transaction_hash)) {
      return reply.code(400).send({ error: "transaction_hash must be a 32-byte hash" });
    }
    if (body.chain_id !== 1) {
      return reply.code(400).send({ error: "this pilot only verifies Ethereum mainnet (chain_id 1)" });
    }
    if (!isAddress(body.vault)) {
      return reply.code(400).send({ error: "vault must be a 20-byte EVM address" });
    }
    if (!Array.isArray(body.risk_market_ids) || body.risk_market_ids.length === 0
      || body.risk_market_ids.some((id) => !/^0x[0-9a-fA-F]{64}$/.test(id))) {
      return reply.code(400).send({ error: "risk_market_ids must contain 32-byte market ids" });
    }
    let threshold: bigint;
    try {
      threshold = BigInt(body.max_residual_assets);
      if (threshold < 0n) throw new Error("negative");
    } catch {
      return reply.code(400).send({ error: "max_residual_assets must be a non-negative integer string" });
    }

    const receipt = await verifyTransaction(body.transaction_hash as Hex, rpcUrl);
    if (receipt.status !== "confirmed" || !receipt.blockNumber) {
      return {
        completion: "receipt-unverified",
        incidentId: body.incident_id,
        receipt,
        residual: null,
      };
    }

    let current;
    try {
      current = await vaultAllocations(body.vault, body.chain_id);
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Morpho allocation lookup failed",
        receipt,
      });
    }
    const riskIds = new Set(body.risk_market_ids.map((id) => id.toLowerCase()));
    const riskAllocations = current.state!.allocation
      .filter(({ market }) => riskIds.has(market.marketId.toLowerCase()))
      .map((allocation) => ({
        marketId: allocation.market.marketId,
        collateralSymbol: allocation.market.collateralAsset?.symbol ?? "unknown",
        supplyAssets: allocation.supplyAssets,
        supplyAssetsUsd: allocation.supplyAssetsUsd,
      }));
    const residualAssets = riskAllocations.reduce((sum, allocation) => sum + BigInt(allocation.supplyAssets), 0n);
    const indexedBlock = BigInt(current.state!.blockNumber);
    const receiptBlock = BigInt(receipt.blockNumber);
    const indexerCaughtUp = indexedBlock >= receiptBlock;
    const thresholdPassed = residualAssets <= threshold;
    const completion = !indexerCaughtUp
      ? "awaiting-indexer"
      : thresholdPassed
        ? "complete"
        : "residual-above-threshold";

    return {
      completion,
      incidentId: body.incident_id,
      receipt,
      residual: {
        source: "https://api.morpho.org/graphql",
        indexedBlock: current.state!.blockNumber,
        receiptBlock: receipt.blockNumber,
        indexerCaughtUp,
        riskMarketCount: riskAllocations.length,
        residualAssets: residualAssets.toString(),
        maxResidualAssets: threshold.toString(),
        thresholdPassed,
        allocations: riskAllocations,
      },
    };
  });

  return app;
}
