import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  FileCheck2,
  LoaderCircle,
  Play,
  Send,
  ShieldCheck,
  Square,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type ConsoleConfig = {
  app: string;
  backendUrl: string;
  appStatus: {
    reachable: boolean;
    deployed: boolean;
    active: boolean;
    artifactReady: boolean;
  };
};

type ConsoleMessage = {
  sender?: string;
  message_key?: string;
  content?: string;
  timestamp?: string;
  is_streaming?: boolean;
  tool_result?: [string, string] | null;
  tool_name?: string;
  tool_arguments?: unknown;
};

type ThreadState = { messages?: ConsoleMessage[] | null; is_processing?: boolean };

const APP_TOOLS = new Set([
  "replay_incident", "verify_transaction", "inspect_vault", "get_pilot_policy",
  "plan_reallocation", "simulate_plan", "finalize_simulation", "verify_execution", "export_evidence",
]);

// Canonical pilot market ids — must match USD0PP_MARKET_ID / PT_USD0PP_MARKET_ID
// in aomi-app/src/tool.rs.
const RISK_MARKETS = {
  usd0pp: "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2",
  ptUsd0pp: "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad",
};

function toolResultJson(message: ConsoleMessage): unknown | null {
  const payload = message.tool_result?.[1];
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function extractPlans(result: unknown): Array<{ planId: string; admissible: boolean; kind: string }> {
  if (typeof result !== "object" || result === null) return [];
  const alternatives = (result as { alternatives?: unknown }).alternatives;
  if (!Array.isArray(alternatives)) return [];
  return alternatives.flatMap((alternative) => {
    if (typeof alternative !== "object" || alternative === null) return [];
    const { plan_id, admissible, kind, action } = alternative as Record<string, unknown>;
    if (typeof plan_id !== "string") return [];
    return [{
      planId: plan_id,
      admissible: admissible === true,
      kind: String(kind ?? action ?? plan_id.split(":").pop() ?? "plan"),
    }];
  });
}

function ToolCard({ message }: { message: ConsoleMessage }) {
  const [open, setOpen] = useState(false);
  const name = message.tool_name?.trim() || message.tool_result?.[0] || "tool";
  const result = message.tool_result?.[1] ?? "";
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(result), null, 2);
    } catch {
      return result;
    }
  }, [result]);
  const args = useMemo(() => {
    if (message.tool_arguments === undefined || message.tool_arguments === null) return null;
    try {
      const text = typeof message.tool_arguments === "string"
        ? message.tool_arguments
        : JSON.stringify(message.tool_arguments);
      return text.length > 220 ? `${text.slice(0, 220)}…` : text;
    } catch {
      return null;
    }
  }, [message.tool_arguments]);
  const family = APP_TOOLS.has(name) ? "app" : "host";
  return (
    <div className={`tool-card ${family}`}>
      <button className="tool-head" onClick={() => setOpen((value) => !value)}>
        <Wrench size={12} />
        <code>{name}</code>
        <span className={`tool-family ${family}`}>{family === "app" ? "LIQSTEWARD TOOL" : "AOMI EVM-CORE"}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {args && <div className="tool-args"><code>{args}</code></div>}
      {open && <pre className="tool-result">{pretty}</pre>}
    </div>
  );
}

function SafePackageCard({ result }: { result: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);
  const builder = result.safe_transaction_builder ?? result;
  const json = useMemo(() => JSON.stringify(builder, null, 2), [builder]);
  const planId = typeof result.plan_id === "string" ? result.plan_id : null;
  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `liqsteward-unsigned-safe-${planId ?? "package"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="artifact-card safe-package">
      <div className="artifact-title"><FileCheck2 size={14} /><b>Unsigned Safe package</b><span className="evidence-tag verified-chain">SIMULATION PASSED</span></div>
      {planId && <code className="artifact-plan">{planId}</code>}
      <p>Safe Transaction Builder JSON for manager review. LiqSteward does not sign, commit, or broadcast.</p>
      <div className="artifact-actions">
        <button className="button primary" onClick={download}><Download size={13} /> Download JSON</button>
        <button className="button ghost" onClick={() => { void navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} Copy
        </button>
      </div>
    </div>
  );
}

export function ControlRoom() {
  const [config, setConfig] = useState<ConsoleConfig | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [state, setState] = useState<ThreadState>({ messages: [], is_processing: false });
  const [draft, setDraft] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    fetch("/api/console/config")
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setError("Console configuration unavailable"));
  }, []);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/console/threads/${threadId}/state`);
        if (response.ok) {
          const next = (await response.json()) as ThreadState;
          if (!cancelled) setState(next);
        }
      } catch {
        // Transient poll failure: keep the last state and retry.
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [threadId]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [state.messages?.length, state.is_processing]);

  const messages = state.messages ?? [];
  const processing = state.is_processing === true;

  const latestByTool = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const message of messages) {
      const name = message.tool_name?.trim() || message.tool_result?.[0];
      if (!name || !message.tool_result?.[1]) continue;
      const parsed = toolResultJson(message);
      if (parsed !== null) map.set(name, parsed);
    }
    return map;
  }, [messages]);

  const plans = useMemo(() => extractPlans(latestByTool.get("plan_reallocation")), [latestByTool]);
  const safePackage = useMemo(() => {
    const result = latestByTool.get("finalize_simulation");
    if (typeof result === "object" && result !== null
      && (result as Record<string, unknown>).status === "unsigned_safe_proposal_ready") {
      return result as Record<string, unknown>;
    }
    return null;
  }, [latestByTool]);

  async function openSession() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/console/threads", { method: "POST" });
      if (!response.ok) throw new Error(`console API returned ${response.status}`);
      const body = (await response.json()) as { threadId: string };
      setThreadId(body.threadId);
      setState({ messages: [], is_processing: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "failed to open session");
    } finally {
      setBusy(false);
    }
  }

  async function send(message: string) {
    if (!threadId || !message.trim() || processing) return;
    setBusy(true);
    setError(null);
    setState((previous) => ({
      is_processing: true,
      messages: [...(previous.messages ?? []), { sender: "user", content: message, message_key: `local-${Date.now()}` }],
    }));
    try {
      const response = await fetch(`/api/console/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) throw new Error(`message rejected (${response.status})`);
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "failed to send");
    } finally {
      setBusy(false);
    }
  }

  async function interrupt() {
    if (!threadId) return;
    await fetch(`/api/console/threads/${threadId}/interrupt`, { method: "POST" }).catch(() => undefined);
  }

  const live = config?.appStatus.active && config?.appStatus.artifactReady;
  const quickActions: Array<{ label: string; step: string; message: string; disabled?: boolean }> = [
    {
      step: "01",
      label: "Inspect vault",
      message: "Run inspect_vault and summarize the pinned block, roles, queues, caps, pending changes, current allocations, rates, and immediately withdrawable liquidity.",
    },
    {
      step: "02",
      label: "Pilot policy",
      message: "Run get_pilot_policy and separate deterministic constraints from assumptions still awaiting Gauntlet confirmation.",
    },
    {
      step: "03",
      label: "Plan reallocation",
      message: `Run plan_reallocation for risk signal manual-${new Date().toISOString().slice(0, 10)} observed now: reduce exposure in the USD0++ market ${RISK_MARKETS.usd0pp} and the PT-USD0++ market ${RISK_MARKETS.ptUsd0pp}. Reason: manager-initiated risk-off drill from the LiqSteward console. Compare all alternatives and state which are admissible.`,
    },
    {
      step: "04",
      label: "Simulate selected plan",
      message: `As the manager I select plan ${selectedPlan || "<paste plan_id>"}. Run simulate_plan for it with manager_selected true, stage the exact calldata through evm-core, and report the fork simulation verdict.`,
      disabled: !selectedPlan,
    },
    {
      step: "05",
      label: "Finalize → Safe package",
      message: "Run finalize_simulation for the passing simulation and return the unsigned Safe Transaction Builder JSON for manager review. Do not submit it.",
    },
  ];

  return (
    <>
      <section className="hero console-hero">
        <div>
          <div className="eyebrow"><CircleDot size={13} /> VAULT CONTROL ROOM <span>/</span> {live ? "AOMI APP LIVE" : "AOMI APP OFFLINE"}</div>
          <h1>Manager console</h1>
          <p className="subtitle">
            Drive the deployed LiqSteward Aomi app: pin live state, plan, fork-simulate, and package unsigned approval — the manager Safe stays authoritative.
          </p>
        </div>
        <div className="console-status">
          <div><span>Aomi app</span><code>{config?.app ?? "…"}</code></div>
          <div><span>Backend</span><code>{config ? new URL(config.backendUrl).host : "…"}</code></div>
          <div>
            <span>Status</span>
            <b className={live ? "ok" : "warn"}>
              {config === null ? "checking…" : live ? "artifact live" : config.appStatus.deployed ? "deployed, artifact pending" : "not deployed"}
            </b>
          </div>
        </div>
      </section>

      {error && <div className="console-error"><AlertTriangle size={14} /> {error}</div>}

      <div className="console-grid">
        <section className="panel console-main">
          <header className="panel-head">
            <div>
              <span className="section-kicker">OPERATOR SESSION</span>
              <h2>{threadId ? `Thread ${threadId.slice(0, 8)}` : "No session"}</h2>
            </div>
            {threadId
              ? (processing
                ? <button className="button ghost" onClick={interrupt}><Square size={12} /> Stop turn</button>
                : <span className="utc">IDLE</span>)
              : <button className="button primary" onClick={openSession} disabled={busy}><Play size={13} /> Open session</button>}
          </header>

          <div className="transcript" ref={transcriptRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
            }}>
            {!threadId && (
              <div className="transcript-empty">
                <Bot size={26} />
                <p>Open a session to operate the vault through the deployed LiqSteward app.<br />
                  Every transaction route is <code>evm_stage_tx → simulate_batch → finalize_simulation</code>; there is no signing or broadcast path.</p>
              </div>
            )}
            {messages.map((message, index) => {
              const key = message.message_key ?? `${index}`;
              if (message.tool_result?.[1]) return <ToolCard key={key} message={message} />;
              if (!message.content?.trim()) return null;
              const sender = message.sender === "user" ? "manager" : message.sender === "notice" ? "notice" : "agent";
              return (
                <div key={key} className={`bubble ${sender}`}>
                  <span className="bubble-sender">{sender === "manager" ? "MANAGER" : sender === "notice" ? "RUNTIME NOTICE" : "LIQSTEWARD"}</span>
                  <p>{message.content}</p>
                </div>
              );
            })}
            {processing && <div className="agent-working"><LoaderCircle size={13} className="spin" /> LiqSteward is working — tool calls stream in as they land…</div>}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={threadId ? "Instruct the manager copilot…" : "Open a session first"}
              disabled={!threadId || processing}
              spellCheck={false}
            />
            <button className="button primary" type="submit" disabled={!threadId || processing || !draft.trim()}>
              <Send size={13} /> Send
            </button>
          </form>
        </section>

        <aside className="console-rail">
          <section className="panel">
            <header className="panel-head slim"><div><span className="section-kicker">WORKFLOW</span><h2>Manager steps</h2></div><TerminalSquare size={18} /></header>
            <div className="quick-actions">
              {quickActions.map((action) => (
                <button
                  key={action.step}
                  className="quick-action"
                  disabled={!threadId || processing || busy || action.disabled}
                  onClick={() => void send(action.message)}
                >
                  <small>{action.step}</small>
                  <b>{action.label}</b>
                  <ArrowUpRight size={13} />
                </button>
              ))}
              <div className="plan-select">
                <small>SELECTED PLAN</small>
                <input
                  value={selectedPlan}
                  onChange={(event) => setSelectedPlan(event.target.value)}
                  placeholder="plan_id from step 03"
                  spellCheck={false}
                />
              </div>
            </div>
          </section>

          {plans.length > 0 && (
            <section className="panel">
              <header className="panel-head slim"><div><span className="section-kicker">ALTERNATIVES</span><h2>Proposed plans</h2></div></header>
              <div className="plan-list">
                {plans.map((plan) => (
                  <button key={plan.planId} className={`plan-row ${selectedPlan === plan.planId ? "active" : ""}`} onClick={() => setSelectedPlan(plan.planId)}>
                    <span className={`plan-badge ${plan.admissible ? "ok" : "no"}`}>{plan.admissible ? "ADMISSIBLE" : "REJECTED"}</span>
                    <code>{plan.planId}</code>
                  </button>
                ))}
              </div>
            </section>
          )}

          {safePackage && <SafePackageCard result={safePackage} />}

          <section className="panel console-boundary">
            <ShieldCheck size={15} />
            <p>The manager-controlled Safe owns approval and execution. This console never exposes <code>evm_commit_txs</code>, signatures, or broadcast.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
