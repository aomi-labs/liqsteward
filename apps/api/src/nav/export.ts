import type { Break, DagNode, Edge, NavReport, ValuationDag } from "./types.js";

export interface ExportBundle {
  schema: "liqsteward/nav-export/v1";
  exported_at: string;
  dag: ValuationDag;
  policy: Record<string, unknown>;
  report: NavReport | null;
  nodes: DagNode[];
  edges: Edge[];
  breaks: Break[];
}

function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function units(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10n ** BigInt(decimals);
  const fraction = (magnitude % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

export function renderHtml(bundle: ExportBundle): string {
  const { dag, report, nodes, breaks } = bundle;
  const decimals = report?.base_asset.decimals ?? dag.base_asset?.decimals ?? 0;
  const symbol = report?.base_asset.symbol ?? dag.base_asset?.symbol ?? "";
  const rows = nodes
    .map(
      (node) => `<tr>
  <td><code>${escape(node.node_id)}</code></td>
  <td>${escape(node.kind)}</td>
  <td class="s-${escape(node.status)}">${escape(node.status)}${node.unresolved ? ` (${escape(node.unresolved.reason)})` : ""}</td>
  <td><code>${escape(node.contract)}</code>${node.market_id ? `<br><small>${escape(node.market_id)}</small>` : ""}</td>
  <td>${node.quantity ? `${escape(units(node.quantity.raw, node.quantity.decimals))} ${escape(node.quantity.symbol)}` : ""}</td>
  <td>${node.valuation?.status === "priced" ? `${escape(units(node.valuation.value_base, decimals))} ${escape(symbol)}<br><small>${escape(node.valuation.primary.source)}</small>` : ""}</td>
  <td>${node.evidence.map((evidence) => `<div><code>${escape(evidence.function_signature)}</code> @${evidence.served_block}<br><small>${escape(evidence.result_keccak)}</small></div>`).join("")}</td>
</tr>`,
    )
    .join("\n");
  const checks = (report?.checks ?? [])
    .map(
      (check) => `<tr><td>${escape(check.id)}</td><td>${escape(check.posted_view)}</td><td class="v-${check.verdict}">${check.verdict}</td><td>${escape(units(check.observed, decimals))}</td><td>${escape(units(check.posted, decimals))}</td><td>${check.delta_bps} / ${check.tolerance_bps}</td></tr>`,
    )
    .join("\n");
  const breakRows = breaks
    .map((item) => `<tr><td>${escape(item.kind)}</td><td>${escape(item.severity)}</td><td>${escape(item.observed)}</td><td>${escape(item.bound)}</td><td>${escape(item.status)}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>NAV report ${escape(dag.dag_id)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:32px;color:#111}
h1,h2{font-weight:600}table{border-collapse:collapse;width:100%;margin:12px 0 24px}
th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f4f4f4}
code{font-size:12px}small{color:#666}.s-unresolved{color:#b00020}.s-priced{color:#0a7a3b}.v-fail{color:#b00020;font-weight:600}.v-pass{color:#0a7a3b}
dl{display:grid;grid-template-columns:200px 1fr;gap:4px 12px}dt{color:#666}
</style></head><body>
<h1>NAV report · ${escape(dag.vault.label)}</h1>
<dl>
<dt>DAG</dt><dd><code>${escape(dag.dag_id)}</code> (${escape(dag.phase)}, ${escape(dag.status)})</dd>
<dt>Pin</dt><dd>block ${dag.pin.block_number} · <code>${escape(dag.pin.block_hash)}</code> · ${escape(dag.pin.pinned_at)}</dd>
<dt>Policy</dt><dd>${escape(dag.policy.policy_id)} v${dag.policy.version} · <code>${escape(dag.policy.digest)}</code></dd>
<dt>DAG digest</dt><dd><code>${escape(report?.dag_digest ?? dag.dag_digest ?? "not compiled")}</code></dd>
${report ? `<dt>Assets</dt><dd>${escape(units(report.totals.assets_base, decimals))} ${escape(symbol)}</dd>
<dt>Liabilities</dt><dd>${escape(units(report.totals.liabilities_base, decimals))} ${escape(symbol)}</dd>
<dt>NAV</dt><dd><b>${escape(units(report.totals.nav_base, decimals))} ${escape(symbol)}</b></dd>` : "<dt>Report</dt><dd>not compiled</dd>"}
<dt>Exported</dt><dd>${escape(bundle.exported_at)}</dd>
</dl>
<h2>Checks</h2>
<table><thead><tr><th>Check</th><th>Posted view</th><th>Verdict</th><th>Observed</th><th>Posted</th><th>Δ bps / tolerance</th></tr></thead><tbody>${checks || "<tr><td colspan=6>none</td></tr>"}</tbody></table>
<h2>Breaks</h2>
<table><thead><tr><th>Kind</th><th>Severity</th><th>Observed</th><th>Bound</th><th>Status</th></tr></thead><tbody>${breakRows || "<tr><td colspan=5>none</td></tr>"}</tbody></table>
<h2>Nodes (${nodes.length})</h2>
<table><thead><tr><th>Node</th><th>Kind</th><th>Status</th><th>Contract</th><th>Quantity</th><th>Value</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
