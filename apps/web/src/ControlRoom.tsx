import { AomiFrame } from "@aomi-labs/widget-lib";
import { useAomiRuntime } from "@aomi-labs/react";
import {
  AlertTriangle,
  ArrowUpRight,
  CircleDot,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ConsoleConfig = {
  app: string;
  backendUrl: string;
  runtimeUrl: string;
  appStatus: {
    reachable: boolean;
    deployed: boolean;
    active: boolean;
    artifactReady: boolean;
    applicationId: number | null;
  };
};

// Canonical pilot market ids — must match USD0PP_MARKET_ID /
// PT_USD0PP_MARKET_ID in aomi-app/src/tool.rs.
const RISK_MARKETS = {
  usd0pp: "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2",
  ptUsd0pp: "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad",
};

type NativeOperatorProps = {
  onError: (error: string | null) => void;
};

function NativeOperator({ onError }: NativeOperatorProps) {
  const runtime = useAomiRuntime();
  const [selectedPlan, setSelectedPlan] = useState("");

  const quickActions = useMemo(() => [
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
  ], [selectedPlan]);

  async function send(message: string) {
    if (runtime.isRunning) return;
    onError(null);
    try {
      await runtime.sendMessage(message);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "The native Aomi runtime rejected the turn");
    }
  }

  return (
    <div className="native-console-grid">
      <section className="native-widget-shell" aria-label="LiqSteward operator session">
        <AomiFrame.Header
          showSidebarTrigger={false}
          withControl
          controlBarProps={{
            hideApiKey: true,
            hideApp: true,
            hideModel: true,
            hideWallet: true,
            hideNetwork: false,
          }}
        >
          <span className="native-session-label">
            {runtime.isRunning ? "LIQSTEWARD WORKING" : "MANAGER SESSION"}
          </span>
        </AomiFrame.Header>
        <AomiFrame.Composer
          welcomeTitle="Operate the vault with LiqSteward"
          withControl={false}
        />
      </section>

      <aside className="console-rail">
        <section className="panel">
          <header className="panel-head slim"><div><span className="section-kicker">WORKFLOW</span><h2>Manager steps</h2></div><TerminalSquare size={18} /></header>
          <div className="quick-actions">
            {quickActions.map((action) => (
              <button
                key={action.step}
                className="quick-action"
                disabled={runtime.isRunning || action.disabled}
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

        <section className="panel console-boundary">
          <ShieldCheck size={15} />
          <p>The manager-controlled Safe owns approval and execution. The native runtime can stage and simulate, but LiqSteward exposes no <code>evm_commit_txs</code>, signature, or broadcast path.</p>
        </section>
      </aside>
    </div>
  );
}

export function ControlRoom() {
  const [config, setConfig] = useState<ConsoleConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/console/config")
      .then((response) => {
        if (!response.ok) throw new Error(`console API returned ${response.status}`);
        return response.json();
      })
      .then(setConfig)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Console configuration unavailable");
      });
  }, []);

  const live = Boolean(config?.appStatus.active && config.appStatus.artifactReady);
  const applicationId = config?.appStatus.applicationId ?? null;

  return (
    <>
      <section className="hero console-hero">
        <div>
          <div className="eyebrow"><CircleDot size={13} /> VAULT CONTROL ROOM <span>/</span> {live ? "AOMI APP LIVE" : "AOMI APP OFFLINE"}</div>
          <h1>Manager console</h1>
          <p className="subtitle">
            Pin live state, plan, fork-simulate, and package unsigned approval through Aomi's native operator surface.
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

      {config && applicationId !== null ? (
        <AomiFrame.Root
          backendUrl={config.runtimeUrl}
          applicationId={applicationId}
          className="dark liqsteward-widget"
          height="690px"
          showSidebar={false}
          walletPosition={null}
          persistThread
          threadPersistenceScope="liqsteward-native-control-room"
        >
          <NativeOperator onError={setError} />
        </AomiFrame.Root>
      ) : (
        <div className="native-widget-loading">
          <TerminalSquare size={22} />
          <p>{config ? "Waiting for the deployed application identity…" : "Connecting to the Aomi runtime…"}</p>
        </div>
      )}
    </>
  );
}
