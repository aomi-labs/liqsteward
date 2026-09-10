import { and, desc, eq, gt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { NavDb } from "./db.js";
import { navBreaks, navDags, navEdges, navEvents, navNodes, navPolicies, navReports } from "./schema.js";
import type { Break, DagNode, Edge, NavReport, ValuationDag } from "./types.js";

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

type DagRow = typeof navDags.$inferSelect;
type NodeRow = typeof navNodes.$inferSelect;
type BreakRow = typeof navBreaks.$inferSelect;

export function dagFromRow(row: DagRow): ValuationDag {
  return {
    dag_id: row.dagId,
    aomi_session_id: row.aomiSessionId,
    vault: { chain_id: row.vaultChainId, address: row.vaultAddress, label: row.vaultLabel },
    pin: { block_number: row.pinBlock, block_hash: row.pinBlockHash, pinned_at: row.pinnedAt.toISOString() },
    policy: { policy_id: row.policyId, version: row.policyVersion, digest: row.policyDigest },
    phase: row.phase as ValuationDag["phase"],
    parent_dag_id: row.parentDagId,
    world: row.world as ValuationDag["world"],
    plan: row.plan as ValuationDag["plan"],
    base_asset: row.baseAsset as ValuationDag["base_asset"],
    status: row.status as ValuationDag["status"],
    root_node_ids: row.rootNodeIds as string[],
    dag_digest: row.dagDigest,
    created_at: row.createdAt.toISOString(),
  };
}

export function nodeFromRow(row: NodeRow): DagNode {
  return {
    node_id: row.nodeId,
    dag_id: row.dagId,
    kind: row.kind as DagNode["kind"],
    status: row.status as DagNode["status"],
    unresolved: row.unresolved as DagNode["unresolved"],
    chain_id: row.chainId,
    contract: row.contract,
    account: row.account,
    market_id: row.marketId,
    quantity: row.quantity as DagNode["quantity"],
    semantic: row.semantic as DagNode["semantic"],
    boundary: row.boundary as DagNode["boundary"],
    evidence: row.evidence as DagNode["evidence"],
    valuation: row.valuation as DagNode["valuation"],
    posted_views: row.postedViews as DagNode["posted_views"],
    child_hints: row.childHints as DagNode["child_hints"],
    expected_reads: row.expectedReads as DagNode["expected_reads"],
    stage: row.stage,
    attempts: row.attempts,
    discovered_by: row.discoveredBy as DagNode["discovered_by"],
    written_at: row.writtenAt.toISOString(),
  };
}

function breakFromRow(row: BreakRow): Break {
  return { ...(row.body as Omit<Break, "break_id" | "dag_id" | "status">), break_id: row.breakId, dag_id: row.dagId, status: row.status as Break["status"] };
}

export class NavStore {
  constructor(private readonly db: NavDb) {}

  // ── policies ──

  async insertPolicy(input: { policy_id: string; vault: string; digest: string; body: Record<string, unknown>; uploaded_by: string }) {
    return this.db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ version: navPolicies.version, digest: navPolicies.digest })
        .from(navPolicies)
        .where(eq(navPolicies.policyId, input.policy_id))
        .orderBy(desc(navPolicies.version))
        .limit(1);
      if (latest && latest.digest === input.digest) {
        return { policy_id: input.policy_id, version: latest.version, digest: latest.digest, unchanged: true };
      }
      const version = (latest?.version ?? 0) + 1;
      const uploadedAt = new Date();
      const body = { ...input.body, version, digest: input.digest, uploaded_at: uploadedAt.toISOString() };
      await tx.insert(navPolicies).values({
        policyId: input.policy_id,
        version,
        digest: input.digest,
        vault: input.vault.toLowerCase(),
        body,
        uploadedBy: input.uploaded_by,
        uploadedAt,
      });
      return { policy_id: input.policy_id, version, digest: input.digest, unchanged: false };
    });
  }

  async policiesForVault(vault: string) {
    return this.db
      .select()
      .from(navPolicies)
      .where(eq(navPolicies.vault, vault.toLowerCase()))
      .orderBy(desc(navPolicies.uploadedAt), desc(navPolicies.version));
  }

  async policy(policyId: string, version?: number) {
    const rows = await this.db
      .select()
      .from(navPolicies)
      .where(version === undefined ? eq(navPolicies.policyId, policyId) : and(eq(navPolicies.policyId, policyId), eq(navPolicies.version, version)))
      .orderBy(desc(navPolicies.version))
      .limit(1);
    return rows[0] ?? null;
  }

  // ── dags ──

  async insertDag(dag: ValuationDag) {
    await this.db.insert(navDags).values({
      dagId: dag.dag_id,
      aomiSessionId: dag.aomi_session_id,
      vaultChainId: dag.vault.chain_id,
      vaultAddress: dag.vault.address,
      vaultLabel: dag.vault.label,
      pinBlock: dag.pin.block_number,
      pinBlockHash: dag.pin.block_hash,
      pinnedAt: new Date(dag.pin.pinned_at),
      policyId: dag.policy.policy_id,
      policyVersion: dag.policy.version,
      policyDigest: dag.policy.digest,
      phase: dag.phase,
      parentDagId: dag.parent_dag_id ?? null,
      world: dag.world ?? null,
      plan: dag.plan ?? null,
      baseAsset: dag.base_asset ?? null,
      status: dag.status,
      rootNodeIds: dag.root_node_ids,
      dagDigest: dag.dag_digest ?? null,
      createdAt: new Date(dag.created_at),
    });
  }

  async dag(dagId: string): Promise<ValuationDag | null> {
    const [row] = await this.db.select().from(navDags).where(eq(navDags.dagId, dagId)).limit(1);
    return row ? dagFromRow(row) : null;
  }

  async dagsForVault(vault: string): Promise<ValuationDag[]> {
    const rows = await this.db
      .select()
      .from(navDags)
      .where(eq(navDags.vaultAddress, vault.toLowerCase()))
      .orderBy(desc(navDags.createdAt))
      .limit(50);
    return rows.map(dagFromRow);
  }

  async updateDag(dagId: string, patch: Partial<{ status: string; dagDigest: string; baseAsset: unknown }>) {
    await this.db.update(navDags).set(patch).where(eq(navDags.dagId, dagId));
  }

  // ── nodes and edges ──

  async upsertNode(node: DagNode) {
    const values = {
      dagId: node.dag_id,
      nodeId: node.node_id,
      kind: node.kind,
      status: node.status,
      unresolved: node.unresolved ?? null,
      chainId: node.chain_id,
      contract: node.contract,
      account: node.account,
      marketId: node.market_id ?? null,
      quantity: node.quantity ?? null,
      semantic: node.semantic,
      boundary: node.boundary,
      evidence: node.evidence,
      valuation: node.valuation ?? null,
      postedViews: node.posted_views,
      childHints: node.child_hints,
      expectedReads: node.expected_reads ?? null,
      stage: node.stage,
      attempts: node.attempts,
      discoveredBy: node.discovered_by,
      writtenAt: new Date(node.written_at),
    };
    await this.db
      .insert(navNodes)
      .values(values)
      .onConflictDoUpdate({ target: [navNodes.dagId, navNodes.nodeId], set: values });
  }

  async node(dagId: string, nodeId: string): Promise<DagNode | null> {
    const [row] = await this.db
      .select()
      .from(navNodes)
      .where(and(eq(navNodes.dagId, dagId), eq(navNodes.nodeId, nodeId)))
      .limit(1);
    return row ? nodeFromRow(row) : null;
  }

  async nodes(dagId: string): Promise<DagNode[]> {
    const rows = await this.db.select().from(navNodes).where(eq(navNodes.dagId, dagId)).orderBy(navNodes.writtenAt);
    return rows.map(nodeFromRow);
  }

  async insertEdge(edge: Edge & { dag_id: string }) {
    await this.db
      .insert(navEdges)
      .values({ dagId: edge.dag_id, parent: edge.parent, child: edge.child, relation: edge.relation })
      .onConflictDoNothing();
  }

  async edges(dagId: string): Promise<Edge[]> {
    const rows = await this.db.select().from(navEdges).where(eq(navEdges.dagId, dagId));
    return rows.map((row) => ({ parent: row.parent, child: row.child, relation: row.relation }));
  }

  // ── reports and breaks ──

  async saveReport(report: NavReport) {
    await this.db
      .insert(navReports)
      .values({ dagId: report.dag_id, body: report, generatedAt: new Date(report.generated_at) })
      .onConflictDoUpdate({ target: navReports.dagId, set: { body: report, generatedAt: new Date(report.generated_at) } });
  }

  async report(dagId: string): Promise<NavReport | null> {
    const [row] = await this.db.select().from(navReports).where(eq(navReports.dagId, dagId)).limit(1);
    return row ? (row.body as NavReport) : null;
  }

  async replaceBreaks(dagId: string, breaks: Break[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(navBreaks).where(and(eq(navBreaks.dagId, dagId), eq(navBreaks.status, "open")));
      for (const item of breaks) {
        const { break_id, dag_id, status, ...body } = item;
        await tx
          .insert(navBreaks)
          .values({ breakId: break_id, dagId: dag_id, status, body })
          .onConflictDoNothing();
      }
    });
  }

  async breaks(dagId: string): Promise<Break[]> {
    const rows = await this.db.select().from(navBreaks).where(eq(navBreaks.dagId, dagId)).orderBy(navBreaks.updatedAt);
    return rows.map(breakFromRow);
  }

  async breakById(breakId: string): Promise<Break | null> {
    const [row] = await this.db.select().from(navBreaks).where(eq(navBreaks.breakId, breakId)).limit(1);
    return row ? breakFromRow(row) : null;
  }

  async updateBreak(item: Break) {
    const { break_id, dag_id: _dag, status, ...body } = item;
    await this.db.update(navBreaks).set({ status, body, updatedAt: new Date() }).where(eq(navBreaks.breakId, break_id));
  }

  // ── events ──

  async appendEvent(dagId: string, name: string, data: Record<string, unknown>): Promise<number> {
    const [row] = await this.db.insert(navEvents).values({ dagId, name, data }).returning({ seq: navEvents.seq });
    return row!.seq;
  }

  async eventsAfter(dagId: string, seq: number) {
    return this.db
      .select()
      .from(navEvents)
      .where(and(eq(navEvents.dagId, dagId), gt(navEvents.seq, seq)))
      .orderBy(navEvents.seq)
      .limit(500);
  }

  async ping() {
    await this.db.execute(sql`select 1`);
  }
}
