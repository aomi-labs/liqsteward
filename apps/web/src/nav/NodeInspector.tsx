import type { ReactNode } from "react";
import type { DagNode, Evidence } from "../nav-types";
import { CopyValue, Pill, formatTime, formatUnits, short } from "./format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nav-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const args = evidence.arguments.map((argument) => (argument.length > 20 ? short(argument, 8, 6) : argument)).join(", ");
  return (
    <li className="nav-evidence">
      <div className="nav-evidence-head">
        <span className={`nav-source ${evidence.source}`}>{evidence.source}</span>
        <code className="nav-evidence-call">{evidence.function_signature}({args})</code>
      </div>
      <div className="nav-evidence-meta">
        <span>→ <CopyValue value={evidence.target} display={short(evidence.target, 8, 6)} /></span>
        <span>block <b>{evidence.served_block.toLocaleString()}</b>{evidence.seq != null ? ` · seq ${evidence.seq}` : ""}</span>
        <span>keccak <CopyValue value={evidence.result_keccak} display={short(evidence.result_keccak, 10, 6)} /></span>
        <span>decoded by <code>{evidence.decoded_by}</code></span>
      </div>
      <details className="nav-raw">
        <summary>raw_result · {Math.max(0, (evidence.raw_result.length - 2) / 2)} bytes</summary>
        <pre>{evidence.raw_result}</pre>
        {evidence.arguments.length > 0 && (
          <>
            <span className="nav-raw-label">arguments</span>
            <pre>{evidence.arguments.join("\n")}</pre>
          </>
        )}
        {evidence.block_hash && <><span className="nav-raw-label">block_hash</span><pre>{evidence.block_hash}</pre></>}
        {evidence.call_id && <><span className="nav-raw-label">call_id</span><pre>{evidence.call_id}</pre></>}
      </details>
    </li>
  );
}

export function NodeInspector({ node }: { node: DagNode | null }) {
  if (!node) {
    return <div className="nav-empty">Select a node in the DAG to inspect its evidence.</div>;
  }
  const valuation = node.valuation ?? null;
  return (
    <div className="nav-inspector">
      <div className="nav-inspector-title">
        <div>
          <span className="section-kicker">{node.kind.replace(/_/g, " ")}</span>
          <h3>{node.semantic.protocol || "unknown protocol"}</h3>
        </div>
        <Pill tone={node.status}>{node.status}</Pill>
      </div>

      {node.status === "unresolved" && node.unresolved && (
        <div className="nav-unresolved">
          <b>{node.unresolved.reason}</b>
          <p>{node.unresolved.detail}</p>
          <small>{node.unresolved.attempts} attempt{node.unresolved.attempts === 1 ? "" : "s"}</small>
        </div>
      )}

      <dl className="nav-rows">
        <Row label="Node id"><CopyValue value={node.node_id} /></Row>
        <Row label="Contract"><CopyValue value={node.contract} /></Row>
        <Row label="Account"><CopyValue value={node.account} /></Row>
        {node.market_id && <Row label="Market"><CopyValue value={node.market_id} /></Row>}
        <Row label="Chain">{node.chain_id}</Row>
        <Row label="Adapter"><code>{node.semantic.adapter_id}@{node.semantic.adapter_version}</code></Row>
        {node.semantic.interface && <Row label="Interface"><code>{node.semantic.interface}</code></Row>}
        <Row label="Boundary">
          <Pill tone={node.boundary.in_scope ? "verified" : "excluded"}>{node.boundary.in_scope ? "in scope" : "out of scope"}</Pill>
          <span className="nav-dim"> {node.boundary.rule}</span>
        </Row>
        <Row label="Discovered by">{node.discovered_by} · stage {node.stage}</Row>
        <Row label="Written">{formatTime(node.written_at)}</Row>
      </dl>

      <section className="nav-block">
        <span className="section-kicker">Quantity</span>
        {node.quantity ? (
          <div className="nav-quantity">
            <strong>{formatUnits(node.quantity.raw, node.quantity.decimals, 8)} <small>{node.quantity.symbol}</small></strong>
            <span className="nav-dim mono">raw {node.quantity.raw} · {node.quantity.decimals} dp · {node.quantity.asset}</span>
          </div>
        ) : (
          <p className="nav-dim">Not yet written by the server.</p>
        )}
      </section>

      <section className="nav-block">
        <span className="section-kicker">Valuation</span>
        {valuation ? (
          <dl className="nav-rows">
            <Row label="Status"><Pill tone={valuation.status === "priced" ? "priced" : valuation.status === "excluded" ? "excluded" : "proposed"}>{valuation.status}</Pill></Row>
            <Row label="Source"><code>{valuation.primary.source}</code></Row>
            <Row label="Price">{formatUnits(valuation.primary.price.raw, valuation.primary.price.decimals, 8)} <span className="nav-dim">{valuation.policy_asset}</span></Row>
            <Row label="Value (base)"><span className="mono">{valuation.value_base}</span></Row>
            {valuation.value_usd && <Row label="Value (USD)"><span className="mono">{valuation.value_usd}</span></Row>}
            <Row label="Confidence"><Pill tone={valuation.confidence === "authoritative" ? "priced" : valuation.confidence === "reference" ? "verified" : "warn"}>{valuation.confidence}</Pill></Row>
            <Row label="Haircut">{valuation.haircut_bps} bps{valuation.deviation_bps != null ? ` · deviation ${valuation.deviation_bps} bps` : ""}</Row>
            <Row label="Staleness">{valuation.primary.staleness_s}s{valuation.primary.observed_at_block != null ? ` · block ${valuation.primary.observed_at_block.toLocaleString()}` : ""}</Row>
            {valuation.primary.provenance && (
              <Row label="Provenance">
                <a href={valuation.primary.provenance.url} target="_blank" rel="noreferrer">{short(valuation.primary.provenance.url, 28, 10)}</a>
                <span className="nav-dim mono"> sha256 {short(valuation.primary.provenance.response_sha256, 8, 6)}</span>
              </Row>
            )}
            {valuation.attested_by && <Row label="Attested by">{valuation.attested_by}</Row>}
          </dl>
        ) : (
          <p className="nav-dim">Unpriced.</p>
        )}
      </section>

      {node.posted_views && node.posted_views.length > 0 && (
        <section className="nav-block">
          <span className="section-kicker">Posted views</span>
          <ul className="nav-list">
            {node.posted_views.map((view) => (
              <li key={view.view_id}><code>{view.view_id}</code><span className="mono">{view.value_raw}</span><span className="nav-dim">evidence #{view.evidence_index}</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="nav-block">
        <span className="section-kicker">Evidence · {node.evidence.length}</span>
        {node.evidence.length === 0
          ? <p className="nav-dim">No verified reads yet.</p>
          : <ul className="nav-evidence-list">{node.evidence.map((evidence, index) => <EvidenceRow key={`${evidence.result_keccak}-${index}`} evidence={evidence} />)}</ul>}
      </section>

      {node.child_hints.length > 0 && (
        <section className="nav-block">
          <span className="section-kicker">Child hints · {node.child_hints.length}</span>
          <ul className="nav-list">
            {node.child_hints.map((hint, index) => (
              <li key={`${hint.contract}-${hint.account}-${index}`}><b>{hint.kind}</b><span className="mono">{short(hint.contract, 6, 4)}</span><span className="nav-dim">{hint.adapter_id}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
