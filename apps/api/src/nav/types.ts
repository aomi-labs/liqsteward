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

export const ASSET_KINDS: ReadonlySet<NodeKind> = new Set([
  "token_balance",
  "vault_share",
  "lending_supply",
  "lp_position",
  "pt_position",
  "claimable",
]);
export const LIABILITY_KINDS: ReadonlySet<NodeKind> = new Set(["lending_debt", "liability"]);

export type NodeStatus = "proposed" | "verified" | "priced" | "excluded" | "unresolved";

export type UnresolvedReason =
  | "probe_failed"
  | "codehash_not_allowlisted"
  | "adapter_unknown"
  | "transport_digest_mismatch"
  | "transport_invalid_hex"
  | "read_oversized"
  | "served_block_mismatch"
  | "world_hash_mismatch"
  | "read_incomplete";

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

export interface PriceObservation {
  source: string;
  price: { raw: string; decimals: number };
  observed_at_block?: number | null;
  observed_at?: string | null;
  staleness_s: number;
  provenance?: { url: string; fetched_at: string; response_sha256: string } | null;
}

export interface Valuation {
  status: "unpriced" | "priced" | "excluded";
  policy_asset: string;
  primary: PriceObservation;
  secondary?: PriceObservation | null;
  deviation_bps?: number | null;
  haircut_bps: number;
  value_base: string;
  value_usd?: string | null;
  confidence: "authoritative" | "reference" | "manual";
  attested_by?: string | null;
}

export interface ChildHint {
  kind: NodeKind;
  contract: string;
  account: string;
  adapter_id: string;
  market_id?: string | null;
}

export interface PostedView {
  view_id: string;
  value_raw: string;
  evidence_index: number;
}

export interface DagNode {
  node_id: string;
  dag_id: string;
  kind: NodeKind;
  status: NodeStatus;
  unresolved?: { reason: UnresolvedReason; detail: string; attempts: number } | null;
  chain_id: number;
  contract: string;
  account: string;
  market_id?: string | null;
  quantity?: { raw: string; decimals: number; symbol: string; asset: string } | null;
  semantic: { protocol: string; adapter_id: string; adapter_version: string; interface?: string | null };
  boundary: { in_scope: boolean; rule: string };
  evidence: Evidence[];
  valuation?: Valuation | null;
  posted_views: PostedView[];
  child_hints: ChildHint[];
  expected_reads?: Array<{ function_signature: string; arguments: string[]; target: string }> | null;
  stage: number;
  attempts: number;
  discovered_by: "agent" | "adapter" | "policy";
  written_at: string;
}

export interface Edge {
  parent: string;
  child: string;
  relation: string;
}

export interface BaseAsset {
  address: string;
  symbol: string;
  decimals: number;
}

export interface ValuationDag {
  dag_id: string;
  aomi_session_id: string;
  vault: { chain_id: number; address: string; label: string };
  pin: { block_number: number; block_hash: string; pinned_at: string };
  policy: { policy_id: string; version: number; digest: string };
  phase: "pre" | "post";
  parent_dag_id?: string | null;
  world?: { block_hash: string; applied_ids: string[]; seq: number } | null;
  plan?: { risk_market_ids: string[]; max_residual_assets: string } | null;
  base_asset?: BaseAsset | null;
  status: "open" | "compiled" | "closed";
  root_node_ids: string[];
  dag_digest?: string | null;
  created_at: string;
}

export interface ReportCheck {
  id: string;
  posted_view: string;
  scope: "vault" | "per_node";
  node_id?: string | null;
  verdict: "pass" | "fail";
  observed: string;
  posted: string;
  delta_bps: number;
  tolerance_bps: number;
  severity: "info" | "warn" | "critical";
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
  checks: ReportCheck[];
  unresolved_in_scope: number;
  generated_at: string;
}

export type BreakKind =
  | "reconciliation"
  | "price_deviation"
  | "stale_price"
  | "unpriced"
  | "unresolved_in_scope"
  | "conservation"
  | "residual_exposure";

export interface Break {
  break_id: string;
  dag_id: string;
  kind: BreakKind;
  check_id?: string | null;
  severity: "info" | "warn" | "critical";
  observed: string;
  bound: string;
  node_ids: string[];
  status: "open" | "explained" | "resolved";
  history: Array<{ status: string; changed_by: string; at: string; note?: string | null }>;
}

/** Body the plugin posts for one node write (one adapter stage). */
export interface NodeWriteBody {
  node_id: string;
  status: "verified" | "unresolved";
  unresolved?: { reason: UnresolvedReason; detail: string } | null;
  stage: number;
  stage_complete: boolean;
  evidence: Evidence[];
  quantity?: DagNode["quantity"];
  semantic: DagNode["semantic"];
  posted_views?: PostedView[];
  child_hints?: ChildHint[];
  base_asset?: BaseAsset | null;
}
