import { AlertTriangle, CircleDot, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Break, ConsoleConfig, DagDetail, ValuationDag } from "./nav-types";
import { DagGraph } from "./nav/DagGraph";
import { NavPanel } from "./nav/NavPanel";
import { NodeInspector } from "./nav/NodeInspector";
import { Operator } from "./nav/Operator";
import { PolicyPanel } from "./nav/PolicyPanel";
import { CopyValue, Pill, errorText, formatTime, readJson, short } from "./nav/format";

const DEFAULT_VAULT = "0x8eb67a509616cd6a7c1b3c8c21d48ff57df3d458";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SSE_EVENTS = ["node.written", "node.priced", "dag.compiled", "break.opened", "break.updated"] as const;
const LIST_POLL_MS = 15_000;

type RightTab = "node" | "nav" | "policy";
type LiveState = "idle" | "live" | "reconnecting";

export function NavOracle() {
  const [config, setConfig] = useState<ConsoleConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vaultInput, setVaultInput] = useState(DEFAULT_VAULT);
  const [vault, setVault] = useState(DEFAULT_VAULT);
  const [dags, setDags] = useState<ValuationDag[]>([]);
  const [dagId, setDagId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DagDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<RightTab>("node");
  const [live, setLive] = useState<LiveState>("idle");
  const detailRequest = useRef(0);

  useEffect(() => {
    fetch("/api/console/config?app=nav-oracle")
      .then((response) => readJson<ConsoleConfig>(response))
      .then(setConfig)
      .catch((reason: unknown) => setError(errorText(reason, "Console configuration unavailable")));
  }, []);

  const loadDags = useCallback(async (address: string) => {
    const response = await fetch(`/api/nav/dags?vault=${encodeURIComponent(address)}`);
    const body = await readJson<{ dags: ValuationDag[] }>(response);
    return body.dags;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const token = ++detailRequest.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/nav/dags/${encodeURIComponent(id)}`);
      const body = await readJson<DagDetail>(response);
      if (token !== detailRequest.current) return;
      setDetail(body);
      setDetailError(null);
    } catch (reason) {
      if (token !== detailRequest.current) return;
      setDetailError(errorText(reason, "DAG unavailable"));
    } finally {
      if (token === detailRequest.current) setLoading(false);
    }
  }, []);

  // Dag list follows the vault; newest first, so the head is the default selection.
  useEffect(() => {
    let cancelled = false;
    setDags([]);
    setDagId(null);
    setDetail(null);
    setSelectedNodeId(null);
    const refresh = () => loadDags(vault)
      .then((list) => {
        if (cancelled) return;
        setDags(list);
        setDagId((current) => (current && list.some((dag) => dag.dag_id === current) ? current : list[0]?.dag_id ?? null));
        setError(null);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(errorText(reason, "DAG list unavailable")); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), LIST_POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [vault, loadDags]);

  // Detail + SSE follow the selected dag.
  useEffect(() => {
    if (!dagId) {
      setDetail(null);
      setLive("idle");
      return;
    }
    void loadDetail(dagId);
    const source = new EventSource(`/api/nav/dags/${encodeURIComponent(dagId)}/events`);
    let pending: number | null = null;
    const schedule = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => { pending = null; void loadDetail(dagId); }, 150);
    };
    source.onopen = () => setLive("live");
    source.onerror = () => setLive("reconnecting");
    for (const name of SSE_EVENTS) source.addEventListener(name, schedule);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      source.close();
      setLive("idle");
    };
  }, [dagId, loadDetail]);

  const nodes = detail?.nodes ?? [];
  const selectedNode = useMemo(() => nodes.find((node) => node.node_id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setTab("node");
  }

  function applyVault(value: string) {
    const trimmed = value.trim();
    setVaultInput(trimmed);
    if (ADDRESS.test(trimmed)) setVault(trimmed.toLowerCase());
  }

  function onBreakUpdated(next: Break) {
    setDetail((current) => current
      ? { ...current, breaks: current.breaks.map((item) => (item.break_id === next.break_id ? next : item)) }
      : current);
  }

  async function refreshAll() {
    try {
      const list = await loadDags(vault);
      setDags(list);
      const target = dagId && list.some((dag) => dag.dag_id === dagId) ? dagId : list[0]?.dag_id ?? null;
      if (target !== dagId) setDagId(target);
      else if (target) await loadDetail(target);
      setError(null);
    } catch (reason) {
      setError(errorText(reason, "Refresh failed"));
    }
  }

  const appLive = Boolean(config?.appStatus.active && config.appStatus.artifactReady);
  const dag = detail?.dag ?? null;
  const validVault = ADDRESS.test(vaultInput);

  return (
    <>
      <section className="hero console-hero nav-hero">
        <div>
          <div className="eyebrow"><CircleDot size={13} /> NAV ORACLE <span>/</span> {appLive ? "AOMI APP LIVE" : "AOMI APP OFFLINE"}</div>
          <h1>Valuation oracle</h1>
          <p className="subtitle">Pin a block, traverse the vault into a verified DAG, price it under policy, and reconcile against posted views.</p>
          <label className={`nav-vault ${validVault ? "" : "invalid"}`}>
            <span>Vault</span>
            <input value={vaultInput} onChange={(event) => applyVault(event.target.value)} spellCheck={false} placeholder="0x…" />
            {dag && <i>{dag.vault.label || "unlabelled"} · chain {dag.vault.chain_id}</i>}
          </label>
        </div>
        <div className="console-status">
          <div><span>Aomi app</span><code>{config?.app ?? "…"}</code></div>
          <div><span>Runtime</span><code>{config?.runtimeUrl ?? "…"}</code></div>
          <div>
            <span>Status</span>
            <b className={appLive ? "ok" : "warn"}>
              {config === null ? "checking…" : appLive ? "artifact live" : config.appStatus.deployed ? "deployed, artifact pending" : "not deployed"}
            </b>
          </div>
          <div>
            <span>Stream</span>
            <b className={live === "live" ? "ok" : "warn"}><i className={`nav-live-dot ${live}`} /> {live}</b>
          </div>
        </div>
      </section>

      {error && <div className="console-error"><AlertTriangle size={14} /> {error}</div>}

      <div className="nav-ide">
        <section className="nav-col nav-col-widget" aria-label="NAV oracle operator session">
          <Operator config={config} vault={vault} dagId={dagId} onError={setError} />
        </section>

        <section className="nav-col panel nav-col-dag" aria-label="Valuation DAG">
          <header className="nav-dag-head">
            <div className="nav-dag-pick">
              <select value={dagId ?? ""} onChange={(event) => { setDagId(event.target.value || null); setSelectedNodeId(null); }} disabled={dags.length === 0}>
                {dags.length === 0 && <option value="">No dags for this vault</option>}
                {dags.map((item) => (
                  <option key={item.dag_id} value={item.dag_id}>
                    {item.phase} · {item.dag_id} · block {item.pin.block_number.toLocaleString()} · {item.status}
                  </option>
                ))}
              </select>
              <button type="button" className="button" onClick={() => void refreshAll()} disabled={loading} title="Refresh">
                <RefreshCw size={13} className={loading ? "spin" : undefined} /> Refresh
              </button>
            </div>
            {dag && (
              <div className="nav-dag-meta">
                <span><small>DAG</small><CopyValue value={dag.dag_id} display={short(dag.dag_id, 10, 6)} /></span>
                <span><small>PHASE</small><Pill tone={dag.phase === "post" ? "warn" : "neutral"}>{dag.phase}</Pill></span>
                <span><small>PIN</small><b>{dag.pin.block_number.toLocaleString()}</b> <CopyValue value={dag.pin.block_hash} display={short(dag.pin.block_hash, 8, 6)} /></span>
                <span><small>POLICY</small><code>{dag.policy.policy_id}</code> v{dag.policy.version} <CopyValue value={dag.policy.digest} display={short(dag.policy.digest, 8, 6)} /></span>
                <span><small>STATUS</small><Pill tone={dag.status === "compiled" ? "priced" : dag.status === "closed" ? "excluded" : "verified"}>{dag.status}</Pill></span>
                {dag.parent_dag_id && <span><small>PARENT</small><CopyValue value={dag.parent_dag_id} display={short(dag.parent_dag_id, 10, 6)} /></span>}
                {dag.world && <span><small>WORLD</small><span className="mono">seq {dag.world.seq} · {dag.world.applied_ids.length} applied</span></span>}
                <span><small>PINNED</small>{formatTime(dag.pin.pinned_at)}</span>
              </div>
            )}
          </header>
          <div className="nav-dag-body">
            {detailError && <div className="console-error nav-inline"><AlertTriangle size={14} /> {detailError}</div>}
            {!dagId && !detailError && <div className="nav-graph-empty">{dags.length === 0 ? "No valuation has been opened for this vault yet." : "Select a dag."}</div>}
            {dag && (
              <DagGraph nodes={nodes} edges={detail?.edges ?? []} rootIds={dag.root_node_ids} selectedId={selectedNodeId} onSelect={selectNode} />
            )}
          </div>
        </section>

        <section className="nav-col panel nav-col-side" aria-label="Inspector">
          <div className="nav-rtabs" role="tablist">
            {(["node", "nav", "policy"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                {id === "node" ? "Node" : id === "nav" ? "NAV" : "Policy"}
                {id === "nav" && detail && detail.breaks.some((item) => item.status === "open") && <i className="nav-tab-dot" />}
              </button>
            ))}
          </div>
          <div className="nav-side-body">
            {tab === "node" && <NodeInspector node={selectedNode} />}
            {tab === "nav" && (dagId && detail
              ? <NavPanel dagId={dagId} report={detail.report} breaks={detail.breaks} nodes={nodes} onBreakUpdated={onBreakUpdated} onSelectNode={selectNode} />
              : <div className="nav-empty">Select a dag to see its report.</div>)}
            {tab === "policy" && <PolicyPanel vault={vault} />}
          </div>
        </section>
      </div>
    </>
  );
}
