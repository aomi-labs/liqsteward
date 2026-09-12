#!/usr/bin/env python3
"""Build a static, self-contained NAV oracle demo page from a recorded
aomi-cli session and the DAG export bundle it produced.

Usage:
  build-nav-demo.py --export nav-export.json --log run4.log --log run6.log ... --out page.html

Nothing on the page is synthesized: the chat is the model's real transcript,
the DAG is the store's export, and every number comes from those two files.
"""
import argparse
import html
import json
import re

LINE = re.compile(r"^\[(\d\d:\d\d:\d\d) [+-]\d\d:\d\d\] \[(user|assistant|tool:[^\]]+)\] ?(.*)$")
SYSTEM = re.compile(r"^\[system:([a-z_ ]+)[^\]]*\](.*)$")


def parse_logs(paths):
    entries = []
    for path in paths:
        current = None
        for raw in open(path, encoding="utf-8", errors="replace").read().splitlines():
            if raw.startswith("exit=") or raw.startswith("== turn") or raw == "loop done":
                continue
            m = LINE.match(raw)
            s = SYSTEM.match(raw)
            if m:
                if current:
                    entries.append(current)
                ts, role, rest = m.groups()
                if role.startswith("tool:"):
                    current = {"role": "tool", "name": role[5:], "ts": ts, "body": rest}
                else:
                    current = {"role": role, "ts": ts, "body": rest}
            elif s:
                if current:
                    entries.append(current)
                    current = None
                kind, rest = s.groups()
                if kind.startswith("error"):
                    entries.append({"role": "system", "ts": "", "body": (kind + rest).strip()})
            elif current is not None:
                current["body"] += "\n" + raw
        if current:
            entries.append(current)
    out = []
    for e in entries:
        if e["role"] == "tool":
            body = e["body"].strip()
            try:
                e["json"] = json.loads(body)
                e.pop("body")
            except json.JSONDecodeError:
                pass
        out.append(e)
    return out


def shorten(value, limit=140):
    if isinstance(value, str):
        return value if len(value) <= limit else value[: limit - 1] + "…"
    if isinstance(value, list):
        return [shorten(v, limit) for v in value]
    if isinstance(value, dict):
        return {k: shorten(v, limit) for k, v in value.items()}
    return value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--log", action="append", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    bundle = json.load(open(args.export))
    transcript = parse_logs(args.log)
    for e in transcript:
        if "json" in e:
            e["json"] = shorten(e["json"])
    data = json.dumps({"bundle": bundle, "transcript": transcript}).replace("</", "<\\/")
    dag = bundle["dag"]
    title = f"NAV Oracle · recorded session · {dag['dag_id']}"
    page = TEMPLATE.replace("__DATA__", data).replace("__TITLE__", html.escape(title))
    open(args.out, "w", encoding="utf-8").write(page)
    tools = sum(1 for e in transcript if e["role"] == "tool")
    print(f"wrote {args.out}: {len(transcript)} transcript entries ({tools} tool calls), {len(bundle['nodes'])} nodes")


TEMPLATE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#f3f0e9;--ink:#1a1a1a;--muted:#6b665c;--line:#d9d3c5;--card:#fbfaf6;--lime:#dff58a;--blue:#3b6fc4;--green:#2f8a3e;--red:#b0392b;--grey:#9a9385;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,Inter,system-ui,sans-serif}
header{display:flex;align-items:baseline;gap:18px;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--card)}
header h1{font:600 22px Georgia,serif;margin:0}header .kicker{font-size:11px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase}
header .meta{margin-left:auto;display:flex;gap:16px;font-family:var(--mono);font-size:11px;color:var(--muted)}
main{display:grid;grid-template-columns:36% minmax(0,1fr) 27%;gap:12px;padding:12px 16px;height:calc(100vh - 62px)}
.panel{background:var(--card);border:1px solid var(--line);border-radius:8px;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.panel h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0;padding:10px 14px;border-bottom:1px solid var(--line)}
.scroll{overflow:auto;padding:12px;flex:1}
.msg{margin:0 0 12px}.msg .who{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
.user .bubble{background:#e9f0d2;border-radius:10px;padding:10px 12px}
.assistant .bubble{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;white-space:pre-wrap}
.tool{border-left:3px solid var(--blue);background:#f6f4ee;border-radius:0 8px 8px 0;padding:6px 10px;margin:0 0 8px;font-family:var(--mono);font-size:11px}
.tool.read{border-left-color:var(--grey)}.tool.write{border-left-color:var(--green)}.tool.bad{border-left-color:var(--red)}
.tool summary{cursor:pointer;display:flex;gap:8px;align-items:center;list-style:none}.tool summary::-webkit-details-marker{display:none}
.tool .name{font-weight:600}.tool .hint{color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto;color:#333}
.system{color:var(--red);font-family:var(--mono);font-size:11px;margin:0 0 8px}
.ts{color:var(--muted);font-size:10px}
svg{width:100%;height:100%}
.node rect{fill:#fff;stroke:var(--line)}.node text{font-size:10px}.node .kind{font-weight:600}.node .pill{font-size:8px;letter-spacing:.08em;text-transform:uppercase}
.st-verified rect{stroke:var(--blue)}.st-priced rect{stroke:var(--green)}.st-unresolved rect{stroke:var(--red)}
.edge{stroke:#c9c2b3;fill:none}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;padding:10px 14px}.kv dt{color:var(--muted)}.kv dd{margin:0;font-family:var(--mono);font-size:11px;word-break:break-all}
.big{padding:10px 14px}.big .n{font:600 26px Georgia,serif}.big .l{font-size:10px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
.nav{background:var(--lime);border-radius:8px;margin:0 14px 10px}
table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:left;padding:5px 8px;border-top:1px solid var(--line)}th{color:var(--muted);font-weight:500}
.pass{color:var(--green);font-weight:600}.fail{color:var(--red);font-weight:600}
.legend{font-size:11px;color:var(--muted);padding:6px 14px;border-top:1px solid var(--line)}
.note{font-size:11px;color:var(--muted);padding:8px 14px;border-top:1px solid var(--line)}
@media (max-width:1100px){main{grid-template-columns:1fr;height:auto}.panel{max-height:70vh}}
</style></head><body>
<header><span class="kicker">NAV oracle · recorded session</span><h1>Gauntlet USDC Core</h1><div class="meta" id="meta"></div></header>
<main>
<section class="panel"><h2>Agent session (real transcript)</h2><div class="scroll" id="chat"></div><div class="note">Every line is the model's own turn, tool call, or tool result from the recorded run through the Aomi host. Long hex results are shortened for display only.</div></section>
<section class="panel"><h2>Position DAG at the pinned block</h2><div class="scroll" id="dag" style="padding:0"></div><div class="legend">blue = verified · green = priced · red = unresolved · every node carries keccak-stamped evidence</div></section>
<section class="panel"><h2>NAV &amp; reconciliation</h2><div class="scroll" id="nav" style="padding:0"></div></section>
</main>
<script>
const DATA = __DATA__;
const {bundle, transcript} = DATA;
const dag = bundle.dag, report = bundle.report, nodes = bundle.nodes, edges = bundle.edges;
const dec = report ? report.base_asset.decimals : 6, sym = report ? report.base_asset.symbol : "";
const fmt = (raw, d=dec) => { const v = BigInt(raw); const neg = v < 0n; const m = neg ? -v : v; const w = m / 10n**BigInt(d); const f = (m % 10n**BigInt(d)).toString().padStart(d,"0").replace(/0+$/,""); return (neg?"-":"") + w.toLocaleString("en-US") + (f ? "."+f : ""); };
const short = (s, l=6, r=4) => s && s.length > l+r+1 ? s.slice(0,l)+"…"+s.slice(-r) : s;
document.getElementById("meta").innerHTML = `<span>dag ${dag.dag_id}</span><span>block ${dag.pin.block_number.toLocaleString("en-US")}</span><span>${short(dag.pin.block_hash,10,6)}</span><span>policy ${dag.policy.policy_id} v${dag.policy.version}</span><span>${dag.status}</span>`;

// chat
const chat = document.getElementById("chat");
for (const e of transcript) {
  if (e.role === "user" || e.role === "assistant") {
    const d = document.createElement("div"); d.className = "msg " + e.role;
    d.innerHTML = `<div class="who">${e.role} <span class="ts">${e.ts}</span></div><div class="bubble"></div>`;
    d.querySelector(".bubble").textContent = e.body.trim();
    chat.appendChild(d);
  } else if (e.role === "tool") {
    const j = e.json; const isRead = e.name.includes("pinned read");
    let cls = isRead ? "read" : (e.name === "write_to_dag" ? "write" : "");
    let hint = "";
    if (isRead && j) { cls = j.success === false ? "bad" : cls; hint = j.success ? `served_block ${j.served_block} · keccak ${short(j.result_keccak,10,6)} · ${(j.result||"").length} chars` : `revert: ${j.revert_reason||""}`; }
    else if (j && e.name === "write_to_dag") { const v = j.verdict || (j.node && j.node.status); cls = v === "unresolved" ? "bad" : "write"; hint = `${v||""} ${j.node ? j.node.kind+" "+j.node.node_id : ""} ${j.frontier_remaining!==undefined ? "· frontier "+j.frontier_remaining : ""} ${j.reason ? "· "+j.reason : ""}`; }
    else if (j && e.name === "expand_node") hint = `${j.kind||""} ${j.node_id||""} · ${j.adapter||""} · stage ${j.stage} · ${(j.reads||[]).length} reads`;
    else if (j && e.name === "open_valuation") hint = `dag ${j.dag_id} · pin ${j.pin && j.pin.block_number}`;
    else if (j && e.name === "compile_nav") hint = j.compiled ? `NAV ${fmt(j.report.totals.nav_base)} ${sym} · ${j.report.checks.length} checks · ${(j.breaks||[]).length} breaks` : `refused: ${j.refused}`;
    else if (j && e.name === "price_nodes") hint = `${(j.priced||[]).length} priced · ${(j.unpriced||[]).length} unpriced`;
    const d = document.createElement("details"); d.className = "tool " + cls;
    d.innerHTML = `<summary><span class="ts">${e.ts}</span><span class="name">${e.name}</span><span class="hint"></span></summary><pre></pre>`;
    d.querySelector(".hint").textContent = hint;
    d.querySelector("pre").textContent = j ? JSON.stringify(j, null, 2) : (e.body || "");
    chat.appendChild(d);
  } else if (e.role === "system") {
    const d = document.createElement("div"); d.className = "system"; d.textContent = e.body; chat.appendChild(d);
  }
}

// dag layout
const byId = new Map(nodes.map(n => [n.node_id, n]));
const parents = new Map(); for (const ed of edges) { if (!parents.has(ed.child)) parents.set(ed.child, []); parents.get(ed.child).push(ed.parent); }
const depth = new Map(); const layer = id => { if (depth.has(id)) return depth.get(id); const ps = parents.get(id) || []; const dd = ps.length ? 1 + Math.max(...ps.map(layer)) : 0; depth.set(id, dd); return dd; };
nodes.forEach(n => layer(n.node_id));
const layers = []; for (const n of nodes) { const l = depth.get(n.node_id); (layers[l] ||= []).push(n); }
const W = 190, H = 58, GX = 26, GY = 70; const cols = Math.max(...layers.map(l => l.length)); const width = Math.max(cols * (W+GX) + GX, 900); const height = layers.length * (H+GY) + 30;
const pos = new Map(); layers.forEach((l, li) => { const total = l.length*(W+GX)-GX; const x0 = (width-total)/2; l.forEach((n, i) => pos.set(n.node_id, {x: x0 + i*(W+GX), y: 20 + li*(H+GY)})); });
let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet" style="min-width:${width}px;height:${height}px">`;
for (const ed of edges) { const a = pos.get(ed.parent), b = pos.get(ed.child); if (!a||!b) continue; svg += `<path class="edge" d="M${a.x+W/2},${a.y+H} C${a.x+W/2},${a.y+H+GY/2} ${b.x+W/2},${b.y-GY/2} ${b.x+W/2},${b.y}"/>`; }
for (const n of nodes) { const p = pos.get(n.node_id); const q = n.quantity ? `${fmt(n.quantity.raw, n.quantity.decimals)} ${n.quantity.symbol}` : (n.unresolved ? n.unresolved.reason : "—"); const colour = {verified:"#3b6fc4",priced:"#2f8a3e",unresolved:"#b0392b"}[n.status] || "#9a9385";
  svg += `<g class="node st-${n.status}" transform="translate(${p.x},${p.y})"><rect width="${W}" height="${H}" rx="6"/><text class="kind" x="10" y="17">${n.kind}</text><text class="pill" x="${W-10}" y="17" text-anchor="end" fill="${colour}">${n.status}</text><text x="10" y="33" fill="#6b665c" font-family="monospace">${short(n.contract)}${n.market_id ? " · "+short(n.market_id,6,4) : ""}</text><text x="10" y="49" font-family="monospace">${q}</text></g>`; }
svg += "</svg>"; document.getElementById("dag").innerHTML = `<div style="overflow:auto;height:100%">${svg}</div>`;

// nav panel
const nav = document.getElementById("nav");
if (report) {
  const checks = report.checks.map(c => `<tr><td>${c.id.split(":")[0]}${c.node_id ? "<br><span style='color:#6b665c;font-family:monospace'>"+c.node_id+"</span>" : ""}</td><td>${fmt(c.observed)}</td><td>${fmt(c.posted)}</td><td>${c.delta_bps} / ${c.tolerance_bps}</td><td class="${c.verdict}">${c.verdict}</td></tr>`).join("");
  const positions = report.positions.map(p => `<tr><td style="font-family:monospace">${p.node_id}</td><td>${p.kind}</td><td>${fmt(p.value_base)} ${sym}</td></tr>`).join("");
  nav.innerHTML = `<div class="big" style="display:grid;grid-template-columns:1fr 1fr"><div><div class="l">Assets</div><div class="n">${fmt(report.totals.assets_base)}</div><div class="l">${sym}</div></div><div><div class="l">Liabilities</div><div class="n">${fmt(report.totals.liabilities_base)}</div><div class="l">${sym}</div></div></div>
  <div class="big nav"><div class="l">Shadow NAV</div><div class="n">${fmt(report.totals.nav_base)}</div><div class="l">${sym} · ${report.positions.length} positions · ${bundle.breaks.length} breaks</div></div>
  <dl class="kv"><dt>Pin</dt><dd>${report.pin.block_number} · ${report.pin.block_hash}</dd><dt>Policy digest</dt><dd>${report.policy_digest}</dd><dt>DAG digest</dt><dd>${report.dag_digest}</dd><dt>Generated</dt><dd>${report.generated_at}</dd></dl>
  <h2>Checks · ${report.checks.length}</h2><table><thead><tr><th>Check</th><th>Observed</th><th>Posted</th><th>Δ bps / tol</th><th></th></tr></thead><tbody>${checks}</tbody></table>
  <h2>Positions</h2><table><thead><tr><th>Node</th><th>Kind</th><th>Value</th></tr></thead><tbody>${positions}</tbody></table>`;
} else nav.innerHTML = `<div class="big">Not compiled</div>`;
</script></body></html>
"""

if __name__ == "__main__":
    main()
