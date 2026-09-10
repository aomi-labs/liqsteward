import { createHash } from "node:crypto";
import type { NavPolicy } from "./policy.js";
import { newId } from "./store.js";
import { ASSET_KINDS, LIABILITY_KINDS, type Break, type DagNode, type NavReport, type ReportCheck, type ValuationDag } from "./types.js";

export type CompileOutcome =
  | { ok: true; report: NavReport; breaks: Break[]; dag_digest: string }
  | { ok: false; refused: string; blocking: Array<{ node_id: string; status: string; reason?: string }> };

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function bps(observed: bigint, posted: bigint): number {
  if (posted === 0n) return observed === 0n ? 0 : 10_000;
  return Number((abs(observed - posted) * 10_000n) / abs(posted));
}

export function dagDigest(nodes: DagNode[]): string {
  const hash = createHash("sha256");
  for (const node of [...nodes].sort((a, b) => a.node_id.localeCompare(b.node_id))) {
    hash.update(node.node_id);
    hash.update(node.status);
    hash.update(node.quantity?.raw ?? "");
    hash.update(node.valuation?.value_base ?? "");
    for (const evidence of node.evidence) hash.update(evidence.result_keccak);
  }
  return `0x${hash.digest("hex")}`;
}

function postedViewValue(nodes: DagNode[], viewId: string, nodeId?: string): bigint | null {
  for (const node of nodes) {
    if (nodeId && node.node_id !== nodeId) continue;
    const view = node.posted_views.find((entry) => entry.view_id === viewId);
    if (view) return BigInt(view.value_raw);
  }
  return null;
}

export function compileDag(dag: ValuationDag, nodes: DagNode[], policy: NavPolicy, now: Date): CompileOutcome {
  const inScope = nodes.filter((node) => node.boundary.in_scope && node.status !== "excluded");
  const blocking = inScope
    .filter((node) => node.status === "proposed" || node.status === "unresolved")
    .map((node) => ({ node_id: node.node_id, status: node.status, reason: node.unresolved?.reason }));
  if (blocking.length > 0) {
    return { ok: false, refused: "in-scope nodes are not verified", blocking };
  }
  const leaves = inScope.filter((node) => ASSET_KINDS.has(node.kind) || LIABILITY_KINDS.has(node.kind));
  const unpriced = leaves.filter((node) => node.valuation?.status !== "priced");
  if (unpriced.length > 0) {
    return { ok: false, refused: "leaves are unpriced", blocking: unpriced.map((node) => ({ node_id: node.node_id, status: node.status, reason: "unpriced" })) };
  }
  const ageSeconds = Math.floor((now.getTime() - new Date(dag.pin.pinned_at).getTime()) / 1000);
  if (ageSeconds > policy.scope.max_block_age_s) {
    return { ok: false, refused: `pin is ${ageSeconds}s old, policy allows ${policy.scope.max_block_age_s}s`, blocking: [] };
  }
  const base = dag.base_asset;
  if (!base) return { ok: false, refused: "dag has no base asset", blocking: [] };

  let assets = 0n;
  let liabilities = 0n;
  let usd: bigint | null = 0n;
  const positions: NavReport["positions"] = [];
  for (const node of leaves) {
    const value = BigInt(node.valuation!.value_base);
    if (ASSET_KINDS.has(node.kind)) assets += value;
    else liabilities += value;
    if (usd !== null) {
      usd = node.valuation!.value_usd !== undefined && node.valuation!.value_usd !== null ? usd + BigInt(node.valuation!.value_usd) : null;
    }
    positions.push({
      node_id: node.node_id,
      kind: node.kind,
      quantity: node.quantity?.raw ?? "0",
      value_base: value.toString(),
      source: node.valuation!.primary.source,
    });
  }
  const nav = assets - liabilities;

  const checks: ReportCheck[] = [];
  const breaks: Break[] = [];
  for (const rule of policy.reconciliation) {
    if (rule.scope === "vault") {
      const posted = postedViewValue(nodes, rule.posted_view);
      const observed = nav;
      if (posted === null) {
        breaks.push({
          break_id: newId("brk"),
          dag_id: dag.dag_id,
          kind: "reconciliation",
          check_id: rule.id,
          severity: rule.severity,
          observed: observed.toString(),
          bound: `posted view ${rule.posted_view} was never read`,
          node_ids: [],
          status: "open",
          history: [{ status: "open", changed_by: "compile", at: now.toISOString(), note: "posted view missing" }],
        });
        continue;
      }
      const delta = bps(observed, posted);
      const verdict = delta <= rule.tolerance_bps ? "pass" : "fail";
      checks.push({ id: rule.id, posted_view: rule.posted_view, scope: "vault", verdict, observed: observed.toString(), posted: posted.toString(), delta_bps: delta, tolerance_bps: rule.tolerance_bps, severity: rule.severity });
      if (verdict === "fail") {
        breaks.push({
          break_id: newId("brk"),
          dag_id: dag.dag_id,
          kind: "reconciliation",
          check_id: rule.id,
          severity: rule.severity,
          observed: observed.toString(),
          bound: `${posted.toString()} ± ${rule.tolerance_bps} bps`,
          node_ids: dag.root_node_ids,
          status: "open",
          history: [{ status: "open", changed_by: "compile", at: now.toISOString(), note: `${delta} bps off ${rule.posted_view}` }],
        });
      }
    } else {
      for (const node of leaves) {
        if (rule.kind_filter && node.kind !== rule.kind_filter) continue;
        const posted = postedViewValue([node], rule.posted_view);
        if (posted === null) continue;
        const observed = BigInt(node.valuation!.value_base);
        const delta = bps(observed, posted);
        const verdict = delta <= rule.tolerance_bps ? "pass" : "fail";
        checks.push({ id: `${rule.id}:${node.node_id}`, posted_view: rule.posted_view, scope: "per_node", node_id: node.node_id, verdict, observed: observed.toString(), posted: posted.toString(), delta_bps: delta, tolerance_bps: rule.tolerance_bps, severity: rule.severity });
        if (verdict === "fail") {
          breaks.push({
            break_id: newId("brk"),
            dag_id: dag.dag_id,
            kind: "reconciliation",
            check_id: rule.id,
            severity: rule.severity,
            observed: observed.toString(),
            bound: `${posted.toString()} ± ${rule.tolerance_bps} bps`,
            node_ids: [node.node_id],
            status: "open",
            history: [{ status: "open", changed_by: "compile", at: now.toISOString(), note: `${delta} bps off ${rule.posted_view}` }],
          });
        }
      }
    }
  }

  if (dag.phase === "post" && dag.plan) {
    const riskIds = new Set(dag.plan.risk_market_ids.map((id) => id.toLowerCase()));
    const bound = BigInt(dag.plan.max_residual_assets);
    let residual = 0n;
    const residualNodes: string[] = [];
    for (const node of leaves) {
      if (node.market_id && riskIds.has(node.market_id.toLowerCase()) && node.kind === "lending_supply") {
        residual += BigInt(node.quantity?.raw ?? "0");
        residualNodes.push(node.node_id);
      }
    }
    const verdict = residual <= bound ? "pass" : "fail";
    checks.push({ id: "residual_exposure", posted_view: "plan.max_residual_assets", scope: "vault", verdict, observed: residual.toString(), posted: bound.toString(), delta_bps: bps(residual, bound), tolerance_bps: 0, severity: "critical" });
    if (verdict === "fail") {
      breaks.push({
        break_id: newId("brk"),
        dag_id: dag.dag_id,
        kind: "residual_exposure",
        check_id: "residual_exposure",
        severity: "critical",
        observed: residual.toString(),
        bound: bound.toString(),
        node_ids: residualNodes,
        status: "open",
        history: [{ status: "open", changed_by: "compile", at: now.toISOString(), note: "post-state supply in risk markets exceeds the plan's bound" }],
      });
    }
  }

  const digest = dagDigest(nodes);
  const report: NavReport = {
    dag_id: dag.dag_id,
    phase: dag.phase,
    pin: { block_number: dag.pin.block_number, block_hash: dag.pin.block_hash },
    policy_digest: dag.policy.digest,
    dag_digest: digest,
    base_asset: { symbol: base.symbol, decimals: base.decimals },
    totals: { assets_base: assets.toString(), liabilities_base: liabilities.toString(), nav_base: nav.toString(), nav_usd: usd?.toString() ?? null },
    positions,
    checks,
    unresolved_in_scope: 0,
    generated_at: now.toISOString(),
  };
  return { ok: true, report, breaks, dag_digest: digest };
}
