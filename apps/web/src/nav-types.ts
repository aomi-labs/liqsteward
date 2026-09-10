// Wire types for the NAV oracle dashboard. Mirrors the server contract in
// docs/prd/nav-oracle.md §6 and §11; every quantity is a decimal string in
// base units and must be formatted with BigInt, never Number().

export type NodeKind =
  | "account"
  | "token_balance"
  | "vault_share"
  | "lending_supply"
  | "lending_debt"
  | "lp_position"
  | "pt_position"
  | "claimable"
  | "liability"
  | "price";

export type NodeStatus = "proposed" | "verified" | "priced" | "excluded" | "unresolved";

export interface ValuationDag {
  dag_id: string;
  aomi_session_id: string;
  vault: { chain_id: number; address: string; label: string };
  pin: { block_number: number; block_hash: string; pinned_at: string };
  policy: { policy_id: string; version: number; digest: string };
  phase: "pre" | "post";
  parent_dag_id?: string | null;
  world?: { block_hash: string; applied_ids: string[]; seq: number } | null;
  status: "open" | "compiled" | "closed";
  root_node_ids: string[];
  dag_digest?: string | null;
  created_at: string;
}

export interface Evidence {
  source: "evm_reads" | "evm_sim";
  call_id?: string | null;
  target: string;
  function_signature: string;
  arguments: string[];
  served_block: number;
  block_hash?: string | null;
  seq?: number | null;
  result_keccak: string;
  raw_result: string;
  decoded_by: string;
}

export interface Valuation {
  status: "unpriced" | "priced" | "excluded";
  policy_asset: string;
  primary: {
    source: string;
    price: { raw: string; decimals: number };
    observed_at_block?: number | null;
    observed_at?: string | null;
    staleness_s: number;
    provenance?: { url: string; fetched_at: string; response_sha256: string } | null;
  };
  secondary?: unknown;
  deviation_bps?: number | null;
  haircut_bps: number;
  value_base: string;
  value_usd?: string | null;
  confidence: "authoritative" | "reference" | "manual";
  attested_by?: string | null;
}

export interface DagNode {
  node_id: string;
  dag_id: string;
  kind: NodeKind;
  status: NodeStatus;
  unresolved?: { reason: string; detail: string; attempts: number } | null;
  chain_id: number;
  contract: string;
  account: string;
  market_id?: string | null;
  quantity?: { raw: string; decimals: number; symbol: string; asset: string } | null;
  semantic: { protocol: string; adapter_id: string; adapter_version: string; interface?: string | null };
  boundary: { in_scope: boolean; rule: string };
  evidence: Evidence[];
  valuation?: Valuation | null;
  posted_views?: Array<{ view_id: string; value_raw: string; evidence_index: number }>;
  child_hints: Array<{ kind: NodeKind; contract: string; account: string; adapter_id: string; market_id?: string | null }>;
  stage: number;
  discovered_by: "agent" | "adapter" | "policy";
  written_at: string;
}

export interface Edge {
  parent: string;
  child: string;
  relation: string;
}

export interface NavReport {
  dag_id: string;
  phase: "pre" | "post";
  pin: { block_number: number; block_hash: string };
  policy_digest: string;
  dag_digest: string;
  base_asset: { symbol: string; decimals: number };
  totals: { assets_base: string; liabilities_base: string; nav_base: string; nav_usd?: string | null };
  positions: Array<{ node_id: string; kind: NodeKind; quantity: string; value_base: string; source: string }>;
  checks: Array<{ id: string; posted_view: string; verdict: "pass" | "fail"; observed: string; posted: string; delta_bps: number }>;
  unresolved_in_scope: number;
  generated_at: string;
}

export interface Break {
  break_id: string;
  dag_id: string;
  kind: string;
  check_id?: string | null;
  severity: "info" | "warn" | "critical";
  observed: string;
  bound: string;
  node_ids: string[];
  status: "open" | "explained" | "resolved";
  history: Array<{ status: string; changed_by: string; at: string; note?: string | null }>;
}

export interface NavPolicy {
  schema: string;
  policy_id: string;
  version: number;
  digest?: string;
  [key: string]: unknown;
}

// Server response envelopes.

export interface ConsoleConfig {
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
}

export interface DagDetail {
  dag: ValuationDag;
  nodes: DagNode[];
  edges: Edge[];
  report: NavReport | null;
  breaks: Break[];
}

export interface PolicyCatalogEntry {
  id: string;
  adapter_id: string;
  description: string;
  scope: "vault" | "per_node";
}

export interface PolicyIndex {
  policies: Array<{ policy_id: string; version: number; digest: string; uploaded_at: string }>;
  latest: NavPolicy | null;
  catalog: PolicyCatalogEntry[];
}
