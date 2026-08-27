import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  LoaderCircle,
  Search,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Tx = {
  hash: string;
  timestamp: number;
  blockNumber: number;
  caller: string;
  suppliedToRiskUsd: number;
  withdrawnFromRiskUsd: number;
  netRiskDeltaUsd: number;
  classification: "risk-in" | "risk-off" | "mixed";
  events: Array<{ type: string; assets: string; market: { label: string; id: string } }>;
};

type Replay = {
  fixture: {
    title: string;
    vault: { address: string; nameAtReplay: string; currentName: string };
    window: { from: string; to: string };
    officialNarrative: { text: string; source: string; status: string };
  };
  summary: {
    observedTransactions: number;
    riskOffTransactions: number;
    riskInTransactions: number;
    suppliedToRiskUsd: number;
    withdrawnFromRiskUsd: number;
    netRiskDeltaUsd: number;
    discrepancy: { severity: string; claim: string; observation: string; interpretation: string } | null;
  };
  timeline: Tx[];
};

type Verification = {
  status: string;
  hash: string;
  from?: string;
  to?: string;
  blockNumber?: string;
  blockTimestamp?: string;
  inputSelector?: string;
  receiptLogs?: number;
  assertions: Array<{ label: string; passed: boolean; evidence: string }>;
};

const short = (value: string, left = 6, right = 4) => `${value.slice(0, left)}…${value.slice(-right)}`;
const money = (value: number) => `$${(value / 1_000_000).toFixed(2)}m`;
const time = (timestamp: number) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC",
}).format(timestamp * 1000);

function EvidenceTag({ kind }: { kind: string }) {
  const label: Record<string, string> = {
    "verified-chain": "CHAIN VERIFIED",
    "official-claim": "OFFICIAL CLAIM",
    derived: "DERIVED",
    unresolved: "UNRESOLVED",
  };
  return <span className={`evidence-tag ${kind}`}>{label[kind] ?? kind.toUpperCase()}</span>;
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="copyable" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      <code>{short(value)}</code>{copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function TransactionRow({ tx, active, onSelect }: { tx: Tx; active: boolean; onSelect: () => void }) {
  const riskOff = tx.classification === "risk-off";
  const value = riskOff ? tx.withdrawnFromRiskUsd : tx.suppliedToRiskUsd;
  return (
    <button className={`tx-row ${active ? "active" : ""}`} onClick={onSelect}>
      <span className={`direction ${riskOff ? "off" : "in"}`}>
        {riskOff ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
      </span>
      <span className="tx-time">{time(tx.timestamp)}<small>Block {tx.blockNumber.toLocaleString()}</small></span>
      <span className="tx-hash"><code>{short(tx.hash, 8, 6)}</code><small>{short(tx.caller, 6, 5)}</small></span>
      <span className={`tx-class ${riskOff ? "off" : "in"}`}>{riskOff ? "RISK-OFF" : "RISK-IN"}</span>
      <span className="tx-value">{money(value)}</span>
      <ChevronRight size={15} className="chevron" />
    </button>
  );
}

export function App() {
  const [data, setData] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [verifyHash, setVerifyHash] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [containment, setContainment] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/incidents/usd0pp")
      .then((response) => { if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json(); })
      .then((replay: Replay) => { setData(replay); setActiveHash(replay.timeline[0]?.hash ?? null); setVerifyHash(replay.timeline[2]?.hash ?? ""); })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const active = useMemo(() => data?.timeline.find(({ hash }) => hash === activeHash), [data, activeHash]);

  async function verify() {
    setVerifying(true);
    setVerification(null);
    const response = await fetch(`/api/transactions/${verifyHash}/verify`);
    setVerification(await response.json());
    setVerifying(false);
  }

  async function openContainment() {
    const response = await fetch("/api/incidents/usd0pp/containment");
    setContainment(await response.json());
  }

  if (error) return <main className="loading"><AlertTriangle /><h1>Replay unavailable</h1><p>{error}</p></main>;
  if (!data) return <main className="loading"><LoaderCircle className="spin" /><p>Reconstructing onchain evidence…</p></main>;

  const { fixture, summary, timeline } = data;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><ShieldCheck size={20} /></span><span>LIQSTEWARD</span><i>VAULT CONTROL</i></div>
        <nav><span className="live"><i /> ETHEREUM LIVE</span><span>Replay <b>USD0++ / 2025-01</b></span></nav>
        <div className="top-actions">
          <a className="button ghost" href="/api/incidents/usd0pp/evidence" download><Download size={14} /> Evidence</a>
          <button className="button primary" onClick={openContainment}><TerminalSquare size={14} /> Inspect route</button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <div className="eyebrow"><CircleDot size={13} /> INCIDENT REPLAY <span>/</span> CLOSED</div>
            <h1>USD0++ risk response</h1>
            <p className="subtitle">Manager-controlled vault operations with independent evidence before and after every proposed transaction.</p>
            <div className="vault-line"><span>{fixture.vault.nameAtReplay}</span><Copyable value={fixture.vault.address} /><span className="renamed">Now {fixture.vault.currentName}</span></div>
          </div>
          <div className="assurance-score">
            <div className="score-ring"><strong>96</strong><span>/ 100</span></div>
            <div><b>Evidence confidence</b><small>Exact public response window pinned</small></div>
          </div>
        </section>

        <section className="metrics">
          <article><span>Observed reallocations</span><strong>{summary.observedTransactions}</strong><EvidenceTag kind="verified-chain" /></article>
          <article><span>Risk withdrawn</span><strong>{money(summary.withdrawnFromRiskUsd)}</strong><EvidenceTag kind="derived" /></article>
          <article><span>Pure risk-off calls</span><strong>{summary.riskOffTransactions} <small>/ {summary.observedTransactions}</small></strong><EvidenceTag kind="verified-chain" /></article>
          <article><span>Initial risk added</span><strong>{money(summary.suppliedToRiskUsd)}</strong><EvidenceTag kind="derived" /></article>
        </section>

        {summary.discrepancy && (
          <section className="reconciliation">
            <span className="warn-icon"><AlertTriangle size={19} /></span>
            <div className="recon-main">
              <div className="section-kicker">RECONCILIATION REQUIRED <EvidenceTag kind="unresolved" /></div>
              <h2>The narrative and the transaction sequence do not cleanly match.</h2>
              <p>{summary.discrepancy.observation}</p>
            </div>
            <div className="claim-box"><EvidenceTag kind="official-claim" /><blockquote>“{summary.discrepancy.claim}”</blockquote><a href={fixture.officialNarrative.source} target="_blank">Gauntlet Vaultbook <ExternalLink size={12} /></a></div>
          </section>
        )}

        <section className="execution-pipeline">
          <div className="pipeline-copy">
            <span className="section-kicker">LIQSTEWARD · POWERED BY AOMI EVM-CORE</span>
            <h2>The manager decides. LiqSteward plans, simulates, and packages approval.</h2>
            <p>The manager Safe remains authoritative. LiqSteward does not sign, commit, or broadcast.</p>
          </div>
          <div className="pipeline-steps">
            <span><small>01</small><b>Evidence</b><code>replay + inspect</code></span>
            <i>→</i>
            <span><small>02</small><b>Stage</b><code>evm_stage_tx</code></span>
            <i>→</i>
            <span className="gate"><small>03 · HARD GATE</small><b>Simulate</b><code>simulate_batch</code></span>
            <i>→</i>
            <span><small>04 · UNSIGNED</small><b>Safe package</b><code>finalize_simulation</code></span>
            <i>→</i>
            <span><small>05 · MANAGER</small><b>Review + execute</b><code>outside Aomi</code></span>
          </div>
        </section>

        <div className="content-grid">
          <section className="panel timeline-panel">
            <header className="panel-head"><div><span className="section-kicker">EXECUTION TRACE</span><h2>Nine observed reallocations</h2></div><span className="utc">UTC · JAN 10 2025</span></header>
            <div className="sequence-bar"><span className="risk-off-width">RISK-OFF · {summary.riskOffTransactions}</span></div>
            <div className="tx-list">{timeline.map((tx) => <TransactionRow key={tx.hash} tx={tx} active={tx.hash === activeHash} onSelect={() => setActiveHash(tx.hash)} />)}</div>
          </section>

          <aside className="panel inspector">
            <header className="panel-head"><div><span className="section-kicker">TRANSACTION INSPECTOR</span><h2>{active ? time(active.timestamp) : "Select a call"}</h2></div><Fingerprint size={22} /></header>
            {active && <>
              <div className="inspector-status"><span className={`direction ${active.classification === "risk-off" ? "off" : "in"}`}>{active.classification === "risk-off" ? <ArrowDownRight /> : <ArrowUpRight />}</span><div><b>{active.classification === "risk-off" ? "Exposure reduced" : "Exposure increased"}</b><small>Net delta {active.netRiskDeltaUsd >= 0 ? "+" : ""}{money(active.netRiskDeltaUsd)}</small></div><EvidenceTag kind="verified-chain" /></div>
              <dl>
                <div><dt>Transaction</dt><dd><Copyable value={active.hash} /></dd></div>
                <div><dt>Caller</dt><dd><Copyable value={active.caller} /></dd></div>
                <div><dt>Block</dt><dd>{active.blockNumber.toLocaleString()}</dd></div>
                <div><dt>Reallocation events</dt><dd>{active.events.length}</dd></div>
              </dl>
              <div className="event-stack">{active.events.map((event, index) => <div className="event" key={`${event.market.id}-${index}`}><span className={event.type === "MarketWithdraw" ? "withdraw" : "supply"}>{event.type === "MarketWithdraw" ? "WITHDRAW" : "SUPPLY"}</span><div><b>{event.market.label}</b><small>{money(Number(event.assets) / 1_000_000)}</small></div></div>)}</div>
              <a className="etherscan" href={`https://etherscan.io/tx/${active.hash}`} target="_blank">Open on Etherscan <ExternalLink size={13} /></a>
            </>}
          </aside>
        </div>

        <section className="panel verifier">
          <div className="verifier-copy"><span className="section-kicker">INDEPENDENT HASH CHECKER</span><h2>Verify the thing that actually landed.</h2><p>Fetch the canonical Ethereum transaction and receipt, then compare sender, block and success status against the indexed reallocation event.</p></div>
          <div className="verify-control"><div className="hash-input"><Search size={16} /><input value={verifyHash} onChange={(event) => setVerifyHash(event.target.value)} spellCheck={false} /></div><button className="button primary" onClick={verify} disabled={verifying}>{verifying ? <LoaderCircle className="spin" size={15} /> : <FileCheck2 size={15} />} Verify receipt</button></div>
          {verification && <div className="verification-result"><div className={`verification-title ${verification.status}`}><ShieldCheck size={18} /><b>{verification.status === "confirmed" ? "Receipt confirmed" : verification.status}</b><span>{verification.assertions.filter(({ passed }) => passed).length}/{verification.assertions.length} assertions passed</span></div><div className="assertions">{verification.assertions.map((assertion) => <div key={assertion.label}><span className={assertion.passed ? "pass" : "fail"}>{assertion.passed ? <Check size={13} /> : <X size={13} />}</span><p><b>{assertion.label}</b><small>{assertion.evidence}</small></p></div>)}</div></div>}
        </section>

        <footer><span><Activity size={13} /> PUBLIC DATA PROTOTYPE</span><p>Built for outside-in validation. No Gauntlet credentials, signing authority, or endorsement implied.</p><span>Schema risk-off-evidence/v1</span></footer>
      </main>

      {containment && <div className="modal-backdrop" onClick={() => setContainment(null)}><section className="modal" onClick={(event) => event.stopPropagation()}><header><div><span className="section-kicker">LIQSTEWARD · HISTORICAL PREVIEW</span><h2>Exact calldata enters the Aomi simulation pipeline.</h2></div><button onClick={() => setContainment(null)}><X /></button></header><div className="route-summary"><code>evm_stage_tx</code><i>→</i><code>simulate_batch</code><i>→</i><code>finalize_simulation</code><i>→</i><code>unsigned Safe JSON</code></div><div className="modal-warning"><AlertTriangle size={17} /><p><b>This USD0++ payload is a counterfactual preview, not a live action.</b><br />For a current incident, the manager reviews exact allocations. LiqSteward stages and simulates the calldata, then produces an unsigned package for the manager-controlled Safe.</p></div><pre>{JSON.stringify(containment, null, 2)}</pre><div className="modal-actions"><a href="/api/incidents/usd0pp/containment" className="button ghost" target="_blank"><ExternalLink size={14} /> Open preview JSON</a><button className="button primary" onClick={() => void navigator.clipboard.writeText(JSON.stringify(containment, null, 2))}><Copy size={14} /> Copy preview</button></div></section></div>}
    </div>
  );
}
