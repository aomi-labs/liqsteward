import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createPublicClient, http, isAddress } from "viem";
import { compileDag } from "./compile.js";
import { NavEvents } from "./events.js";
import { renderHtml, type ExportBundle } from "./export.js";
import { POSTED_VIEW_CATALOG, adapterFor, adapterVersion, exclusionFor, policyDigest, validatePolicy, type NavPolicy } from "./policy.js";
import { priceNode } from "./pricing.js";
import { newId, type NavStore } from "./store.js";
import type { ChildHint, DagNode, Edge, NodeWriteBody, ValuationDag } from "./types.js";
import { nodeIdFor, verifyEvidence } from "./verify.js";

export interface NavRouteOptions {
  store: NavStore;
  /** Bearer token Aomi apps present. Unset = plugin routes answer 503. */
  serviceToken?: string;
  /** JSON-RPC used only to pin a block number and hash at open time. */
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Blocks below the head to pin when the caller gives none. */
  pinDepth?: number;
}

const TRANSPORT_REASONS = new Set(["transport_digest_mismatch", "transport_invalid_hex", "read_oversized", "served_block_mismatch", "world_hash_mismatch", "read_incomplete"]);
const MAX_ATTEMPTS = 3;

function relationFor(parent: DagNode, child: ChildHint): Edge["relation"] {
  if (child.kind === "price") return "priced_by";
  if (child.kind === "lending_debt" || child.kind === "liability") return "owes";
  if (parent.kind === "vault_share") return "represents";
  return "owns";
}

export function registerNav(app: FastifyInstance, options: NavRouteOptions) {
  const { store } = options;
  const events = new NavEvents(store);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const pinDepth = options.pinDepth ?? 2;
  const rpc = options.rpcUrl ? createPublicClient({ transport: http(options.rpcUrl) }) : null;

  type PluginRequest = FastifyRequest & { aomiSession: string };

  async function requireService(request: FastifyRequest, reply: FastifyReply) {
    if (!options.serviceToken) {
      return reply.code(503).send({ error: "nav service token is not configured" });
    }
    const header = request.headers.authorization ?? "";
    if (header !== `Bearer ${options.serviceToken}`) {
      return reply.code(401).send({ error: "invalid service token" });
    }
    const session = request.headers["x-aomi-session"];
    if (typeof session !== "string" || !session.trim()) {
      return reply.code(400).send({ error: "x-aomi-session header is required" });
    }
    (request as PluginRequest).aomiSession = session;
    return undefined;
  }

  async function ownedOpenDag(request: FastifyRequest, reply: FastifyReply, dagId: string): Promise<ValuationDag | undefined> {
    const dag = await store.dag(dagId);
    if (!dag) {
      reply.code(404).send({ error: `dag ${dagId} not found` });
      return undefined;
    }
    if (dag.aomi_session_id !== (request as PluginRequest).aomiSession) {
      reply.code(403).send({ error: "dag belongs to another session" });
      return undefined;
    }
    if (dag.status !== "open") {
      reply.code(409).send({ error: `dag is ${dag.status}` });
      return undefined;
    }
    return dag;
  }

  async function loadPolicy(dag: ValuationDag): Promise<NavPolicy> {
    const row = await store.policy(dag.policy.policy_id, dag.policy.version);
    if (!row) throw new Error(`policy ${dag.policy.policy_id} v${dag.policy.version} vanished`);
    const parsed = validatePolicy(row.body);
    if (parsed.ok === false) throw new Error(`stored policy is invalid: ${parsed.error}`);
    return parsed.policy;
  }

  // ── policies ──

  app.get<{ Params: { vault: string }; Querystring: { policy_id?: string; version?: string } }>("/api/nav/policies/:vault", async (request, reply) => {
    const { vault } = request.params;
    if (!isAddress(vault)) return reply.code(400).send({ error: "vault must be an address" });
    const rows = await store.policiesForVault(vault);
    let latest = rows[0] ?? null;
    if (request.query.policy_id) {
      const version = request.query.version ? Number(request.query.version) : undefined;
      latest = await store.policy(request.query.policy_id, version);
      if (!latest) return reply.code(404).send({ error: "policy version not found" });
    }
    return {
      policies: rows.map((row) => ({ policy_id: row.policyId, version: row.version, digest: row.digest, uploaded_at: row.uploadedAt.toISOString() })),
      latest: latest?.body ?? null,
      catalog: POSTED_VIEW_CATALOG,
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/api/nav/policies", { preHandler: requireService }, async (request, reply) => {
    const parsed = validatePolicy(request.body);
    if (parsed.ok === false) return reply.code(400).send({ error: parsed.error });
    const policy = parsed.policy;
    const vault = policy.scope.owned_accounts[0]!;
    const digest = policyDigest(policy as unknown as Record<string, unknown>);
    const stored = await store.insertPolicy({ policy_id: policy.policy_id, vault, digest, body: policy as unknown as Record<string, unknown>, uploaded_by: policy.uploaded_by });
    return reply.code(stored.unchanged ? 200 : 201).send(stored);
  });

  // ── dags ──

  app.get<{ Querystring: { vault?: string } }>("/api/nav/dags", async (request, reply) => {
    const vault = request.query.vault;
    if (!vault || !isAddress(vault)) return reply.code(400).send({ error: "vault query parameter must be an address" });
    return { dags: await store.dagsForVault(vault) };
  });

  app.post<{
    Body: {
      vault: string;
      chain_id: number;
      policy_id?: string;
      policy_version?: number;
      block?: number | string;
      phase?: "pre" | "post";
      parent_dag_id?: string;
      world?: { block_hash: string; applied_ids: string[]; seq: number };
      plan?: { risk_market_ids: string[]; max_residual_assets: string };
      label?: string;
    };
  }>("/api/nav/dags", { preHandler: requireService }, async (request, reply) => {
    const body = request.body ?? ({} as typeof request.body);
    if (!body.vault || !isAddress(body.vault)) return reply.code(400).send({ error: "vault must be an address" });
    if (typeof body.chain_id !== "number") return reply.code(400).send({ error: "chain_id must be a number" });
    const vault = body.vault.toLowerCase();

    const policyRow = body.policy_id
      ? await store.policy(body.policy_id, body.policy_version)
      : (await store.policiesForVault(vault))[0] ?? null;
    if (!policyRow) return reply.code(400).send({ error: `no accounting policy uploaded for ${vault}` });
    const parsed = validatePolicy(policyRow.body);
    if (parsed.ok === false) return reply.code(500).send({ error: `stored policy invalid: ${parsed.error}` });
    const policy = parsed.policy;
    if (policy.scope.chain_id !== body.chain_id) return reply.code(400).send({ error: `policy is for chain ${policy.scope.chain_id}` });
    if (!policy.scope.owned_accounts.some((account) => account.toLowerCase() === vault)) {
      return reply.code(400).send({ error: "vault is not in the policy's owned_accounts" });
    }

    const phase = body.phase ?? "pre";
    let pin: ValuationDag["pin"];
    let parent: ValuationDag | null = null;
    if (phase === "post") {
      if (!body.parent_dag_id) return reply.code(400).send({ error: "post phase needs parent_dag_id" });
      parent = await store.dag(body.parent_dag_id);
      if (!parent) return reply.code(404).send({ error: "parent dag not found" });
      if (parent.aomi_session_id !== (request as PluginRequest).aomiSession) return reply.code(403).send({ error: "parent dag belongs to another session" });
      if (!body.world?.block_hash) return reply.code(400).send({ error: "post phase needs the sim world stamp" });
      if (body.world.block_hash.toLowerCase() !== parent.pin.block_hash.toLowerCase()) {
        return reply.code(400).send({ error: "world_hash_mismatch", detail: `world ${body.world.block_hash} != parent pin ${parent.pin.block_hash}` });
      }
      pin = { ...parent.pin, pinned_at: now().toISOString() };
    } else {
      if (!rpc) return reply.code(503).send({ error: "no RPC configured to pin a block" });
      let blockNumber: bigint;
      if (body.block !== undefined && body.block !== null && body.block !== "") {
        blockNumber = BigInt(body.block);
      } else {
        blockNumber = (await rpc.getBlockNumber()) - BigInt(pinDepth);
      }
      let blockHash: string;
      try {
        blockHash = (await rpc.getBlock({ blockNumber })).hash;
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
        return reply.code(502).send({ error: `cannot pin block ${blockNumber}: ${detail}` });
      }
      pin = { block_number: Number(blockNumber), block_hash: blockHash, pinned_at: now().toISOString() };
    }

    const dagId = newId("dag");
    const roots: DagNode[] = policy.scope.owned_accounts.map((account) => {
      const adapter = adapterFor(policy, account);
      const nodeId = nodeIdFor({ chain_id: body.chain_id, block_number: pin.block_number, kind: "account", contract: account, account });
      return {
        node_id: nodeId,
        dag_id: dagId,
        kind: "account",
        status: adapter ? "proposed" : "unresolved",
        unresolved: adapter ? null : { reason: "adapter_unknown", detail: `no adapter pinned to ${account} in the policy`, attempts: 0 },
        chain_id: body.chain_id,
        contract: account.toLowerCase(),
        account: account.toLowerCase(),
        semantic: { protocol: adapter?.id.split("_")[0] ?? "unknown", adapter_id: adapter?.id ?? "none", adapter_version: adapter?.version ?? "0" },
        boundary: { in_scope: true, rule: "scope.owned_accounts" },
        evidence: [],
        posted_views: [],
        child_hints: [],
        stage: 0,
        attempts: 0,
        discovered_by: "policy",
        written_at: now().toISOString(),
      };
    });
    const dag: ValuationDag = {
      dag_id: dagId,
      aomi_session_id: (request as PluginRequest).aomiSession,
      vault: { chain_id: body.chain_id, address: vault, label: body.label ?? parent?.vault.label ?? vault },
      pin,
      policy: { policy_id: policyRow.policyId, version: policyRow.version, digest: policyRow.digest },
      phase,
      parent_dag_id: parent?.dag_id ?? null,
      world: phase === "post" ? body.world : null,
      plan: body.plan ?? parent?.plan ?? null,
      base_asset: parent?.base_asset ?? null,
      status: "open",
      root_node_ids: roots.map((node) => node.node_id),
      created_at: now().toISOString(),
    };
    await store.insertDag(dag);
    for (const root of roots) await store.upsertNode(root);
    return reply.code(201).send({ dag, roots });
  });

  app.get<{ Params: { id: string } }>("/api/nav/dags/:id", async (request, reply) => {
    const dag = await store.dag(request.params.id);
    if (!dag) return reply.code(404).send({ error: "dag not found" });
    const [nodes, edges, report, breaks] = await Promise.all([store.nodes(dag.dag_id), store.edges(dag.dag_id), store.report(dag.dag_id), store.breaks(dag.dag_id)]);
    return { dag, nodes, edges, report, breaks };
  });

  app.get<{ Params: { id: string } }>("/api/nav/dags/:id/frontier", async (request, reply) => {
    const dag = await store.dag(request.params.id);
    if (!dag) return reply.code(404).send({ error: "dag not found" });
    const nodes = await store.nodes(dag.dag_id);
    return {
      frontier: nodes.filter((node) => node.boundary.in_scope
        && (node.status === "proposed" || (node.status === "unresolved" && node.attempts < MAX_ATTEMPTS && TRANSPORT_REASONS.has(node.unresolved?.reason ?? "")))),
    };
  });

  app.get<{ Params: { id: string; nid: string } }>("/api/nav/dags/:id/nodes/:nid", async (request, reply) => {
    const node = await store.node(request.params.id, request.params.nid);
    if (!node) return reply.code(404).send({ error: "node not found" });
    return node;
  });

  app.post<{ Params: { id: string; nid: string }; Body: { stage: number; expected_reads: DagNode["expected_reads"] } }>(
    "/api/nav/dags/:id/nodes/:nid/plan",
    { preHandler: requireService },
    async (request, reply) => {
      const dag = await ownedOpenDag(request, reply, request.params.id);
      if (!dag) return;
      const node = await store.node(dag.dag_id, request.params.nid);
      if (!node) return reply.code(404).send({ error: "node not found" });
      const retryable = node.status === "unresolved" && node.attempts < MAX_ATTEMPTS && TRANSPORT_REASONS.has(node.unresolved?.reason ?? "");
      if (node.status !== "proposed" && !retryable) return reply.code(409).send({ error: `node is ${node.status}; only proposed or retryable unresolved nodes take a plan` });
      const body = request.body;
      if (typeof body?.stage !== "number" || !Array.isArray(body.expected_reads)) return reply.code(400).send({ error: "stage and expected_reads are required" });
      const updated: DagNode = { ...node, stage: body.stage, expected_reads: body.expected_reads };
      await store.upsertNode(updated);
      return updated;
    },
  );

  app.post<{ Params: { id: string }; Body: NodeWriteBody }>("/api/nav/dags/:id/nodes", { preHandler: requireService }, async (request, reply) => {
    const dag = await ownedOpenDag(request, reply, request.params.id);
    if (!dag) return;
    const body = request.body;
    if (!body?.node_id) return reply.code(400).send({ error: "node_id is required" });
    const node = await store.node(dag.dag_id, body.node_id);
    if (!node) return reply.code(404).send({ error: "node not found; nodes are created by the server from child_hints" });
    if (node.status === "verified" || node.status === "priced") return reply.code(409).send({ error: `node is already ${node.status}` });
    if (node.status === "excluded") return reply.code(409).send({ error: "node is excluded by policy" });
    if (node.attempts >= MAX_ATTEMPTS) return reply.code(409).send({ error: `node exhausted ${MAX_ATTEMPTS} attempts; it stays unresolved` });
    const policy = await loadPolicy(dag);
    const stamp = now().toISOString();

    const fail = async (reason: NonNullable<DagNode["unresolved"]>["reason"], detail: string) => {
      const attempts = TRANSPORT_REASONS.has(reason) ? node.attempts + 1 : node.attempts;
      const updated: DagNode = { ...node, status: "unresolved", unresolved: { reason, detail, attempts }, attempts, written_at: stamp };
      await store.upsertNode(updated);
      await events.emit(dag.dag_id, "node.written", { node_id: node.node_id, status: "unresolved", reason });
      return reply.code(200).send({ node: updated, children: [] });
    };

    if (body.status === "unresolved") {
      return fail(body.unresolved?.reason ?? "probe_failed", body.unresolved?.detail ?? "plugin reported unresolved");
    }
    if (!Array.isArray(body.evidence) || body.evidence.length === 0) return fail("read_incomplete", "no evidence supplied");
    for (const evidence of body.evidence) {
      const verdict = verifyEvidence(evidence, dag);
      if (verdict.ok === false) return fail(verdict.reason, verdict.detail);
    }
    if (node.expected_reads && node.stage === body.stage) {
      const missing = node.expected_reads.filter(
        (expected) => !body.evidence.some(
          (evidence) => evidence.function_signature === expected.function_signature
            && evidence.target.toLowerCase() === expected.target.toLowerCase()
            && JSON.stringify(evidence.arguments) === JSON.stringify(expected.arguments),
        ),
      );
      if (missing.length > 0) return fail("read_incomplete", `missing ${missing.map((read) => read.function_signature).join(", ")}`);
    }
    if (body.quantity && body.quantity.raw !== undefined && !/^\d+$/.test(body.quantity.raw)) return reply.code(400).send({ error: "quantity.raw must be a non-negative integer string" });

    const evidence = [...node.evidence, ...body.evidence];
    const postedViews = [...node.posted_views, ...(body.posted_views ?? []).map((view) => ({ ...view, evidence_index: view.evidence_index + node.evidence.length }))];
    const complete = body.stage_complete === true;
    const updated: DagNode = {
      ...node,
      status: complete ? "verified" : "proposed",
      unresolved: null,
      quantity: body.quantity ?? node.quantity ?? null,
      semantic: body.semantic ?? node.semantic,
      evidence,
      posted_views: postedViews,
      child_hints: complete ? (body.child_hints ?? []) : node.child_hints,
      expected_reads: null,
      stage: body.stage + 1,
      written_at: stamp,
    };
    await store.upsertNode(updated);
    if (body.base_asset && !dag.base_asset) {
      await store.updateDag(dag.dag_id, { baseAsset: { ...body.base_asset, address: body.base_asset.address.toLowerCase() } });
    }

    const children: DagNode[] = [];
    if (complete) {
      for (const hint of body.child_hints ?? []) {
        const contract = hint.contract.toLowerCase();
        const account = hint.account.toLowerCase();
        const childId = nodeIdFor({ chain_id: dag.vault.chain_id, block_number: dag.pin.block_number, kind: hint.kind, contract, account, market_id: hint.market_id });
        const existing = await store.node(dag.dag_id, childId);
        if (existing) {
          await store.insertEdge({ dag_id: dag.dag_id, parent: node.node_id, child: childId, relation: relationFor(updated, hint) });
          children.push(existing);
          continue;
        }
        const exclusion = exclusionFor(policy, contract);
        const version = adapterVersion(policy, hint.adapter_id);
        const child: DagNode = {
          node_id: childId,
          dag_id: dag.dag_id,
          kind: hint.kind,
          status: exclusion ? "excluded" : version ? "proposed" : "unresolved",
          unresolved: exclusion || version ? null : { reason: "adapter_unknown", detail: `policy does not allow adapter ${hint.adapter_id}`, attempts: 0 },
          chain_id: dag.vault.chain_id,
          contract,
          account,
          market_id: hint.market_id ?? null,
          semantic: { protocol: hint.adapter_id.split("_")[0] ?? "unknown", adapter_id: hint.adapter_id, adapter_version: version ?? "0" },
          boundary: exclusion ? { in_scope: false, rule: `exclusions: ${exclusion}` } : { in_scope: true, rule: `discovered by ${node.semantic.adapter_id}` },
          evidence: [],
          posted_views: [],
          child_hints: [],
          stage: 0,
          attempts: 0,
          discovered_by: "adapter",
          written_at: stamp,
        };
        await store.upsertNode(child);
        await store.insertEdge({ dag_id: dag.dag_id, parent: node.node_id, child: childId, relation: relationFor(updated, hint) });
        children.push(child);
      }
    }
    await events.emit(dag.dag_id, "node.written", { node_id: node.node_id, status: updated.status, children: children.map((child) => child.node_id) });
    return { node: updated, children };
  });

  app.post<{ Params: { id: string }; Body: { node_ids?: string[] } }>("/api/nav/dags/:id/price", { preHandler: requireService }, async (request, reply) => {
    const dag = await ownedOpenDag(request, reply, request.params.id);
    if (!dag) return;
    const policy = await loadPolicy(dag);
    const nodes = await store.nodes(dag.dag_id);
    const wanted = request.body?.node_ids ? new Set(request.body.node_ids) : null;
    const priced: string[] = [];
    const unpriced: Array<{ node_id: string; reason: string }> = [];
    for (const node of nodes) {
      if (wanted && !wanted.has(node.node_id)) continue;
      if (node.status !== "verified" && node.status !== "priced") continue;
      if (!node.quantity) continue;
      const outcome = await priceNode(node, dag, policy, { fetchImpl, now });
      if ("valuation" in outcome) {
        await store.upsertNode({ ...node, status: "priced", valuation: outcome.valuation });
        await events.emit(dag.dag_id, "node.priced", { node_id: node.node_id, value_base: outcome.valuation.value_base });
        priced.push(node.node_id);
      } else {
        unpriced.push(outcome);
      }
    }
    return { priced, unpriced };
  });

  app.post<{ Params: { id: string } }>("/api/nav/dags/:id/compile", { preHandler: requireService }, async (request, reply) => {
    const dag = await ownedOpenDag(request, reply, request.params.id);
    if (!dag) return;
    const policy = await loadPolicy(dag);
    const nodes = await store.nodes(dag.dag_id);
    const outcome = compileDag(dag, nodes, policy, now());
    if (outcome.ok === false) return reply.code(409).send({ refused: outcome.refused, blocking: outcome.blocking });
    await store.saveReport(outcome.report);
    await store.replaceBreaks(dag.dag_id, outcome.breaks);
    await store.updateDag(dag.dag_id, { status: "compiled", dagDigest: outcome.dag_digest });
    await events.emit(dag.dag_id, "dag.compiled", { nav_base: outcome.report.totals.nav_base, checks: outcome.report.checks.length, breaks: outcome.breaks.length });
    for (const item of outcome.breaks) await events.emit(dag.dag_id, "break.opened", { break_id: item.break_id, kind: item.kind, severity: item.severity });
    return { report: outcome.report, breaks: outcome.breaks };
  });

  async function bundle(dagId: string): Promise<ExportBundle | null> {
    const dag = await store.dag(dagId);
    if (!dag) return null;
    const [nodes, edges, report, breaks, policyRow] = await Promise.all([
      store.nodes(dagId),
      store.edges(dagId),
      store.report(dagId),
      store.breaks(dagId),
      store.policy(dag.policy.policy_id, dag.policy.version),
    ]);
    return { schema: "liqsteward/nav-export/v1", exported_at: now().toISOString(), dag, policy: (policyRow?.body as Record<string, unknown>) ?? {}, report, nodes, edges, breaks };
  }

  app.get<{ Params: { id: string } }>("/api/nav/dags/:id/export.json", async (request, reply) => {
    const data = await bundle(request.params.id);
    if (!data) return reply.code(404).send({ error: "dag not found" });
    reply.header("content-disposition", `attachment; filename="nav-${request.params.id}.json"`);
    return data;
  });

  app.get<{ Params: { id: string } }>("/api/nav/dags/:id/export.html", async (request, reply) => {
    const data = await bundle(request.params.id);
    if (!data) return reply.code(404).send({ error: "dag not found" });
    return reply.type("text/html; charset=utf-8").send(renderHtml(data));
  });

  app.get<{ Params: { id: string } }>("/api/nav/dags/:id/events", async (request, reply) => {
    const dag = await store.dag(request.params.id);
    if (!dag) return reply.code(404).send({ error: "dag not found" });
    reply.hijack();
    await events.stream(request, reply, dag.dag_id);
  });

  // ── breaks ──

  app.patch<{ Params: { id: string }; Body: { status: "open" | "explained" | "resolved"; note?: string; changed_by?: string } }>("/api/nav/breaks/:id", { preHandler: requireService }, async (request, reply) => {
    const item = await store.breakById(request.params.id);
    if (!item) return reply.code(404).send({ error: "break not found" });
    const dag = await store.dag(item.dag_id);
    if (!dag || dag.aomi_session_id !== (request as PluginRequest).aomiSession) {
      return reply.code(403).send({ error: "break belongs to another session" });
    }
    const body = request.body;
    if (!body || !["open", "explained", "resolved"].includes(body.status)) return reply.code(400).send({ error: "status must be open, explained, or resolved" });
    const updated = {
      ...item,
      status: body.status,
      history: [...item.history, { status: body.status, changed_by: body.changed_by ?? "dashboard", at: now().toISOString(), note: body.note ?? null }],
    };
    await store.updateBreak(updated);
    await events.emit(item.dag_id, "break.updated", { break_id: item.break_id, status: body.status });
    return updated;
  });
}
