import { ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Break, DagNode, NavReport, NodeStatus } from "../nav-types";
import { CopyValue, Pill, errorText, formatBps, formatTime, formatUnits, readJson, short } from "./format";

const STATUSES: NodeStatus[] = ["proposed", "verified", "priced", "excluded", "unresolved"];

function BreakCard({ item, onUpdated, onSelectNode }: { item: Break; onUpdated: (next: Break) => void; onSelectNode: (nodeId: string) => void }) {
  const [status, setStatus] = useState<Break["status"]>(item.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/nav/breaks/${encodeURIComponent(item.break_id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note: note.trim() || undefined, changed_by: "dashboard" }),
      });
      onUpdated(await readJson<Break>(response));
      setNote("");
    } catch (reason) {
      setError(errorText(reason, "Break update failed"));
    } finally {
      setBusy(false);
    }
  }

  const last = item.history[item.history.length - 1];
  return (
    <li className={`nav-break ${item.severity}`}>
      <div className="nav-break-head">
        <b>{item.kind.replace(/_/g, " ")}</b>
        <Pill tone={item.severity}>{item.severity}</Pill>
        <Pill tone={item.status}>{item.status}</Pill>
      </div>
      <div className="nav-break-values">
        <span><small>OBSERVED</small><code>{item.observed}</code></span>
        <span><small>BOUND</small><code>{item.bound}</code></span>
      </div>
      <div className="nav-break-meta">
        {item.check_id && <span>check <code>{item.check_id}</code></span>}
        {item.node_ids.map((nodeId) => (
          <button key={nodeId} type="button" className="nav-link" onClick={() => onSelectNode(nodeId)}><code>{short(nodeId, 8, 4)}</code></button>
        ))}
        {last && <span className="nav-dim">{last.changed_by} · {formatTime(last.at)}{last.note ? ` · ${last.note}` : ""}</span>}
      </div>
      <form className="nav-break-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <select value={status} onChange={(event) => setStatus(event.target.value as Break["status"])} disabled={busy}>
          <option value="open">open</option>
          <option value="explained">explained</option>
          <option value="resolved">resolved</option>
        </select>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="note" disabled={busy} />
        <button type="submit" className="button" disabled={busy}>{busy ? <LoaderCircle size={12} className="spin" /> : "Update"}</button>
      </form>
      {error && <div className="nav-inline-error">{error}</div>}
    </li>
  );
}

export function NavPanel({ dagId, report, breaks, nodes, onBreakUpdated, onSelectNode }: {
  dagId: string;
  report: NavReport | null;
  breaks: Break[];
  nodes: DagNode[];
  onBreakUpdated: (next: Break) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const counts = STATUSES.map((status) => ({ status, count: nodes.filter((node) => node.status === status).length }));
  const openBreaks = breaks.filter((item) => item.status !== "resolved");

  return (
    <div className="nav-report">
      {report ? (
        <>
          <div className="nav-totals">
            <article><span>Assets</span><strong>{formatUnits(report.totals.assets_base, report.base_asset.decimals, 2)}</strong><small>{report.base_asset.symbol}</small></article>
            <article><span>Liabilities</span><strong>{formatUnits(report.totals.liabilities_base, report.base_asset.decimals, 2)}</strong><small>{report.base_asset.symbol}</small></article>
            <article className="nav-total-main"><span>NAV</span><strong>{formatUnits(report.totals.nav_base, report.base_asset.decimals, 2)}</strong><small>{report.base_asset.symbol}{report.totals.nav_usd ? ` · $${report.totals.nav_usd}` : ""}</small></article>
          </div>
          <div className="nav-report-meta">
            <span>phase <b>{report.phase}</b></span>
            <span>pin <b>{report.pin.block_number.toLocaleString()}</b></span>
            <span>dag digest <CopyValue value={report.dag_digest} display={short(report.dag_digest, 8, 6)} /></span>
            <span>policy <CopyValue value={report.policy_digest} display={short(report.policy_digest, 8, 6)} /></span>
            <span>unresolved in scope <b className={report.unresolved_in_scope > 0 ? "nav-bad" : ""}>{report.unresolved_in_scope}</b></span>
            <span className="nav-dim">{formatTime(report.generated_at)}</span>
            <a className="nav-link" href={`/api/nav/dags/${encodeURIComponent(dagId)}/export.json`} target="_blank" rel="noreferrer">export.json <ExternalLink size={10} /></a>
            <a className="nav-link" href={`/api/nav/dags/${encodeURIComponent(dagId)}/export.html`} target="_blank" rel="noreferrer">export.html <ExternalLink size={10} /></a>
          </div>

          <section className="nav-block">
            <span className="section-kicker">Checks · {report.checks.length}</span>
            {report.checks.length === 0 ? <p className="nav-dim">No posted-view checks in this policy.</p> : (
              <div className="nav-table-scroll">
                <table className="nav-table">
                  <thead><tr><th>id</th><th>posted view</th><th>observed</th><th>posted</th><th>Δ</th><th>verdict</th></tr></thead>
                  <tbody>
                    {report.checks.map((check) => (
                      <tr key={check.id}>
                        <td><code>{check.id}</code></td>
                        <td><code>{check.posted_view}</code></td>
                        <td className="mono">{check.observed}</td>
                        <td className="mono">{check.posted}</td>
                        <td className="mono">{formatBps(check.delta_bps)}</td>
                        <td><Pill tone={check.verdict}>{check.verdict}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="nav-block">
            <span className="section-kicker">Positions · {report.positions.length}</span>
            <div className="nav-table-scroll">
              <table className="nav-table">
                <thead><tr><th>node</th><th>kind</th><th>quantity</th><th>value ({report.base_asset.symbol})</th><th>source</th></tr></thead>
                <tbody>
                  {report.positions.map((position) => (
                    <tr key={position.node_id}>
                      <td><button type="button" className="nav-link" onClick={() => onSelectNode(position.node_id)}><code>{short(position.node_id, 8, 4)}</code></button></td>
                      <td>{position.kind}</td>
                      <td className="mono">{position.quantity}</td>
                      <td className="mono">{formatUnits(position.value_base, report.base_asset.decimals, 2)}</td>
                      <td><code>{position.source}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="nav-not-compiled">
          <b>Not compiled</b>
          <p className="nav-dim">Price every verified node, then run compile_nav to fold the DAG into a report.</p>
          <div className="nav-counts">
            {counts.map(({ status, count }) => <span key={status}><Pill tone={status}>{status}</Pill><b>{count}</b></span>)}
          </div>
        </div>
      )}

      <section className="nav-block">
        <span className="section-kicker">Break queue · {openBreaks.length} open / {breaks.length}</span>
        {breaks.length === 0 ? <p className="nav-dim">No breaks.</p> : (
          <ul className="nav-breaks">
            {breaks.map((item) => <BreakCard key={`${item.break_id}-${item.status}`} item={item} onUpdated={onBreakUpdated} onSelectNode={onSelectNode} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
