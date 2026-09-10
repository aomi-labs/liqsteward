import { AomiFrame } from "@aomi-labs/widget-lib";
import { useAomiRuntime } from "@aomi-labs/react";
import { ArrowUpRight, TerminalSquare } from "lucide-react";
import type { ConsoleConfig } from "../nav-types";

type QuickAction = { label: string; message: string; needsDag: boolean };

function Composer({ vault, dagId, onError }: { vault: string; dagId: string | null; onError: (error: string | null) => void }) {
  const runtime = useAomiRuntime();
  const dag = dagId ?? "<select a dag>";
  const actions: QuickAction[] = [
    {
      label: "Open valuation",
      needsDag: false,
      message: `Activate the nav-oracle/traversal skill, then call open_valuation for vault ${vault} on chain 1 and follow every returned route until the frontier is empty.`,
    },
    {
      label: "Price & compile",
      needsDag: true,
      message: `Activate nav-oracle/accounting, call get_accounting_policy for ${vault}, price every verified node with price_nodes for dag ${dag}, then compile_nav and report the checks and breaks.`,
    },
    {
      label: "Export report",
      needsDag: true,
      message: `Call export_nav_report for dag ${dag} and give me both links.`,
    },
    {
      label: "Post-state",
      needsDag: true,
      message: `Activate nav-oracle/postconditions and value the post-state of dag ${dag} for the reallocation I describe next.`,
    },
  ];

  async function send(message: string) {
    if (runtime.isRunning) return;
    onError(null);
    try {
      await runtime.sendMessage(message);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "The Aomi runtime rejected the turn");
    }
  }

  return (
    <>
      <div className="nav-widget-frame">
        <AomiFrame.Header
          showSidebarTrigger
          withControl
          controlBarProps={{ hideApiKey: true, hideApp: true, hideModel: true, hideWallet: true, hideNetwork: false }}
        >
          <span className="native-session-label">{runtime.isRunning ? "NAV ORACLE WORKING" : "VALUATION SESSION"}</span>
        </AomiFrame.Header>
        <AomiFrame.Composer welcomeTitle="Value the vault with the NAV oracle" withControl={false} />
      </div>
      <div className="nav-quick">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="quick-action"
            disabled={runtime.isRunning || (action.needsDag && !dagId)}
            title={action.needsDag && !dagId ? "Select a dag first" : action.message}
            onClick={() => void send(action.message)}
          >
            <b>{action.label}</b>
            <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
    </>
  );
}

export function Operator({ config, vault, dagId, onError }: {
  config: ConsoleConfig | null;
  vault: string;
  dagId: string | null;
  onError: (error: string | null) => void;
}) {
  const applicationId = config?.appStatus.applicationId ?? null;
  if (!config || applicationId === null) {
    return (
      <div className="native-widget-loading nav-widget-loading">
        <TerminalSquare size={22} />
        <p>{config ? "Waiting for the deployed nav-oracle application identity…" : "Connecting to the Aomi runtime…"}</p>
      </div>
    );
  }
  return (
    <AomiFrame.Root
      backendUrl={config.runtimeUrl}
      applicationId={applicationId}
      className="dark liqsteward-widget nav-widget"
      height="100%"
      showSidebar
      defaultSidebarOpen={false}
      walletPosition={null}
      products={null}
      persistThread
      threadPersistenceScope={`nav-oracle-agent-v1:${config.runtimeUrl}`}
    >
      <Composer vault={vault} dagId={dagId} onError={onError} />
    </AomiFrame.Root>
  );
}
