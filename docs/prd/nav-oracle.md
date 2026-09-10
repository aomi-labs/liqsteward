# PRD: NAV Oracle

Agentic, block-pinned, evidence-backed vault valuation, delivered as an Aomi app (`nav-oracle`) plus a backend surface (`/api/nav/*` in `apps/api`) and a dashboard tab (`NavOracle` in `apps/web`).

Status: design locked 2026-09-10; milestones 0 through 3 built the same day and verified end to end against a live pinned block (see section 12). Milestone 4 (post-state) has its tools and server paths in place but has not been driven end to end.

## 1. Problem

A vault manager sees one number for what the vault is worth: the vault's own `totalAssets()`. That number is produced by the same contracts whose behaviour the manager is trying to supervise. When a collateral depegs, a market's oracle lags, or an allocation lands in the wrong market, the posted value keeps looking fine until it does not. The manager has no independent, reproducible view of what the vault holds, what each position is worth under their own accounting rules, and where the posted value and the independent value disagree.

The USD0++ incident (January 2025) is the reference case: nine reallocations over six hours, each admissible on paper, and no receipt-block reconciliation that would have shown residual exposure after each one.

## 2. What ships

A NAV that is:

- **Pinned.** Every valuation session is one block. Every read is at that block.
- **Evidence-backed.** Every quantity in the DAG is decoded from bytes the host stamped with `result_keccak`. The model relays; the app re-hashes. A mismatch is a status, not a number.
- **Policy-bound.** Boundaries, price sources, tolerances, exclusions, manual valuations, and reconciliation checks come from a user-uploaded policy with a digest. The agent never chooses an accounting treatment.
- **Reconciled.** Shadow NAV versus the vault's posted view, per policy-selected check, with attributable breaks.
- **Post-state capable.** The same DAG built again inside a session simulation world after applying a proposed reallocation, so residual exposure is measured rather than estimated.

## 3. Non-goals for v1

- Planning or admissibility logic for reallocations. `stage_reallocation` takes explicit allocations; Transaction Builder (next app) will author them.
- Pendle PT adapters. The shape lands as `unresolved(adapter_unknown)` in the break queue.
- Cryptographic attestation of manual valuations. `attested_by` is a plain string; the policy digest binds it.
- Owner assignment or audit workflow for breaks beyond status and note.
- Agentic policy authoring (see section 13).
- Any change to the Aomi runtime. The app uses the host as shipped.

## 4. How the runtime constrains the design

The Aomi completion loop is the only caller of tools. An app is a plugin: its tools run when the agent calls them, and it cannot call host tools itself. Routes an app returns are rendered as suggested next actions and re-issued by the model, so every routed argument transits the model as text. Measured consequence in this repo: a 452-byte calldata came back as 441, 453, and 461 bytes across attempts. Only short, digest-sized facts survive.

Facts established from the host at `origin/main` (post PR 1045):

- `evm-reads`: `encode_and_call` (with `block_tag`), `get_account_info`, `get_contract`, `get_erc20_balance`, `get_time_and_onchain_context`, `sync_chain`. Every result carries `served_block` and `result_keccak`.
- `evm-sim`: `evm_stage_tx`, `sim_open`, `sim_apply`, `sim_call`, `sim_snapshot`, `sim_revert`, `sim_close`. Worlds are keyed by thread; results carry a `sim` stamp `{chain_id, block_number, block_hash, forks, applied, seq}`. No commit tool exists in this namespace.
- Historical reads go through the managed Anvil fork to its upstream archive provider. There is no age guard; an unavailable block fails loudly and never falls back to latest.
- `served_block` is the tag echoed back, not read from the response. Byte identity rests on `result_keccak`.
- Enforcement (`enforce(Stop, …)`) only injects the minted `pending_tx_id` for `simulate_batch` and `evm_commit_txs`. `sim_apply` cannot be an enforced target from an app.
- Persisted tool results are truncated at 6 000 characters. Routes have no step cap.
- App skills are activation-only, several per app, about 4k tokens each, with optional guard tables.
- The platform requires the app's `aomi-sdk` pin to equal the backend's exactly. Backend is on 5.0.0.

Design responses: one function per read, results under 1 000 characters; the agent drives traversal one hop per route; the app verifies every relayed byte; the post phase is agent-driven with the short `pending_tx_id` copied by the model and verified by the `sim` stamp.

## 5. Architecture

```
Aomi runtime (host)                     nav-oracle (plugin, this repo)          apps/api (Fastify BFF)         apps/web (NavOracle tab)
──────────────────                      ──────────────────────────────          ──────────────────────         ───────────────────────
agent ── evm-reads / evm-sim ──►        open_valuation                          POST /api/nav/dags             DAG view
  results: served_block, result_keccak  get_accounting_policy                   GET  /api/nav/policies/:vault  Node inspector (evidence, keccak)
                                        expand_node   → route (reads at N)      POST …/nodes/:nid/plan         Policy upload (validate, digest)
agent relays raw_result + keccak ──►    write_to_dag  → rehash, decode, write   POST …/nodes                   NAV + break queue
                                        price_nodes   → policy-bound valuation  POST …/price  (ext: sources)   Aomi widget beside the DAG
                                        compile_nav   → fold, checks, breaks    POST …/compile
                                        export_nav_report                       GET  …/export
                                        stage_reallocation → route (stage)      GET  …/events (SSE)
                                                                                Postgres (Drizzle)
```

Two identities per valuation: the runtime's `session_id` (from `DynToolCallCtx`) and the server-minted `dag_id`. The server checks that every write to a DAG comes from the session that opened it.

## 6. Data contract

Quantities are decimal strings in base units. Nothing is a float.

```ts
type DagId = `dag_${string}`;   // server-minted ULID
type NodeId = `n_${string}`;    // sha256(chain, block, kind, contract, account)[:12] — deterministic, so retries upsert

interface ValuationDag {
  dag_id: DagId;
  aomi_session_id: string;
  vault: { chain_id: number; address: Address; label: string };
  pin: { block_number: number; block_hash: Hash32; pinned_at: ISO8601 };
  policy: { policy_id: string; version: number; digest: Sha256 };   // frozen at open
  phase: "pre" | "post";
  parent_dag_id?: DagId;                                             // post only
  world?: { block_hash: Hash32; applied_ids: string[]; seq: number }; // post only; block_hash must equal pin
  status: "open" | "compiled" | "closed";
  root_node_ids: NodeId[];
  dag_digest?: Sha256;
}

type NodeKind = "account" | "token_balance" | "vault_share" | "lending_supply" | "lending_debt"
              | "lp_position" | "pt_position" | "claimable" | "liability" | "price" | "posted_view";
type NodeStatus = "proposed" | "verified" | "priced" | "excluded" | "unresolved";
type UnresolvedReason = "probe_failed" | "codehash_not_allowlisted" | "adapter_unknown"
  | "transport_digest_mismatch" | "transport_invalid_hex" | "read_oversized"
  | "served_block_mismatch" | "world_hash_mismatch" | "read_incomplete";

interface DagNode {
  node_id: NodeId; dag_id: DagId; kind: NodeKind; status: NodeStatus;
  unresolved?: { reason: UnresolvedReason; detail: string; attempts: number };
  chain_id: number; contract: Address; account: Address;
  quantity?: { raw: string; decimals: number; symbol: string };      // server-written from verified evidence only
  semantic: { protocol: string; adapter_id: string; adapter_version: string; interface?: string; market_id?: Hash32 };
  boundary: { in_scope: boolean; rule: string };
  evidence: Evidence[];
  valuation?: Valuation;
  expected_reads?: string[];                                          // set by expand_node; all must be present
  child_hints: Array<{ kind: NodeKind; contract: Address; account: Address; adapter_id: string }>;
  discovered_by: "agent" | "adapter" | "policy";
  written_at: ISO8601;
}

interface Edge { parent: NodeId; child: NodeId; relation: "owns" | "represents" | "backs" | "owes" | "priced_by" | "posted_by" }

interface Evidence {
  source: "evm_reads" | "evm_sim";
  call_id?: string;
  target: Address; function_signature: string; arguments: string[];
  served_block: number;                // == pin.block_number
  block_hash?: Hash32; seq?: number;   // evm_sim stamp; block_hash == pin.block_hash
  result_keccak: Hash32;               // host stamp
  raw_result: Hex;                     // relayed; keccak(raw_result) == result_keccak
  decoded_by: string;                  // "morpho_blue_market@1.0.0"
}

interface Valuation {
  status: "unpriced" | "priced" | "excluded";
  policy_asset: string;
  primary: PriceObservation; secondary?: PriceObservation; deviation_bps?: number;
  haircut_bps: number;
  value_base: string;                  // vault base asset units; drives every check
  value_usd?: string;                  // optional overlay
  confidence: "authoritative" | "reference" | "manual";
  attested_by?: string;
}

interface PriceObservation {
  source: string;                      // "chain:chainlink:USDC/USD" | "ext:coingecko:usd0" | "policy:manual"
  price: { raw: string; decimals: number };
  observed_at_block?: number; observed_at?: ISO8601; staleness_s: number;
  evidence?: Evidence;                 // chain: sources — a price node written through write_to_dag
  provenance?: { url: string; fetched_at: ISO8601; response_sha256: Sha256 }; // ext: sources — server-fetched
}
```

`chain:` price sources are pinned reads the agent makes at N and writes as `price` nodes. `ext:` sources are fetched by the server with response hashes as provenance. The policy decides which; the plugin never fetches.

## 7. Policy

```ts
interface NavPolicy {
  schema: "liqsteward/nav-policy/v1";
  policy_id: string; version: number; digest: Sha256;   // digest over canonical JSON minus itself; versions immutable
  uploaded_by: string; uploaded_at: ISO8601;
  scope: { chain_id: number; owned_accounts: Address[];
           boundary: Array<{ include: string } | { exclude: string; reason: string }>;
           max_block_age_s: number; archive_required: boolean };
  adapters: Array<{ id: string; version: string; codehash?: Hash32; contract?: Address }>;
  pricing: Record<string, { source: string; secondary?: string; max_staleness_s: number; max_deviation_bps: number; haircut_bps: number }>;
  liabilities: string[];
  manual_valuations: Array<{ contract: Address; kind: NodeKind; value_base: string; attested_by: string; reason: string }>;
  exclusions: Array<{ contract: Address; reason: string }>;
  reconciliation: Array<{ id: string; scope: "vault" | "per_node"; kind_filter?: NodeKind;
                          posted_view: string; tolerance_bps: number; severity: "info" | "warn" | "critical" }>;
  tolerances: { total_assets_conservation_bps: number };
}
```

Reconciliation is opt-in accounting practice. Adapters declare a catalog of `posted_views`, each a reviewed read plan. The policy selects which views to check and with what tolerance. `compile_nav` runs only the selected checks. The dashboard lists the catalog on the policy page.

v1 catalog:

| posted_view | adapter | reads | value |
|---|---|---|---|
| `metamorpho.total_assets` | metamorpho_vault | `totalAssets()` | vault-level posted assets |
| `metamorpho.last_total_assets` | metamorpho_vault | `lastTotalAssets()` | last accrual checkpoint |
| `morpho_market.shares_to_assets` | morpho_blue_market | `position`, `market` | supply shares × current rate, no accrual |
| `morpho_market.expected_supply_assets` | morpho_blue_market | `position`, `market`, `idToMarketParams`, IRM `borrowRateView`, block timestamp | Morpho's `expectedSupplyAssets` (accrued to N) |
| `erc4626.convert_to_assets` | erc4626_generic | `balanceOf`, `convertToAssets` | share value per the vault's own conversion |

Policy authoring in v1 is JSON upload with server validation and digest, plus the pilot policy committed as a fixture.

## 8. Adapters

An adapter is host-side code that knows one contract shape: it authors the read plan (`expand_node`), verifies applicability (codehash or contract pin from the policy), decodes verified bytes into `quantity` and `child_hints`, and declares its `posted_views`. Adapters are reviewed code; policy JSON only selects among them.

| adapter_id | applies to | reads | children |
|---|---|---|---|
| `erc20_balance` | any ERC-20 | `balanceOf(owner)`, `decimals()`, `symbol()` | none |
| `metamorpho_vault` | MetaMorpho v1.x | `asset()`, `MORPHO()`, `withdrawQueueLength()`, `withdrawQueue(i)` ×n, `fee()`, `feeRecipient()` | one `lending_supply` per queued market, account = vault |
| `morpho_blue_market` | Morpho Blue singleton | `position(id, account)`, `market(id)`, `idToMarketParams(id)` | none; `lending_debt` if borrow shares > 0 |
| `erc4626_generic` | any ERC-4626 | `asset()`, `balanceOf(owner)`, `convertToAssets(balance)` | `token_balance` on the underlying |

Everything else is `unresolved(adapter_unknown)`.

Decoders, share math, and interest accrual live in `aomi-app/liqsteward-core/src/abi.rs`; adapters live in `nav-oracle` until a second app needs one.

## 9. Plugin tools

| Tool | Args | Returns | Notes |
|---|---|---|---|
| `open_valuation` | `vault, chain_id, policy_id?, block?, phase?, parent_dag_id?` | `{dag_id, pin, policy, root_node_ids}` | pins latest−2 unless `block` given; probes `totalAssets()` at N first; post phase requires `parent_dag_id` and a world whose `block_hash` equals the parent's pin |
| `get_accounting_policy` | `vault, policy_id?, version?` | `NavPolicy` | the DAG's frozen version by default |
| `expand_node` | `dag_id, node_id, adapter_id` | route: one `encode_and_call{block_tag: N}` (pre) or `sim_call` (post) per read | records `expected_reads` on the node |
| `write_to_dag` | `dag_id, node_id, reads: Evidence[]` | the node (`verified` or `unresolved`) + `child_hints` | verification order: session owns dag → dag open → `served_block` (and `block_hash`/`seq` for sim) → keccak → adapter applicability → decode → all `expected_reads` present. All-or-nothing. `attempts` incremented; retries stop at 3 |
| `price_nodes` | `dag_id, node_ids[]` | `{priced[], unpriced[{node_id, reason}]}` | server resolves `ext:` sources; `chain:` prices must already be price nodes |
| `compile_nav` | `dag_id` | `NavReport` summary + `breaks[]`, or refusal with blocking nodes | refuses on any in-scope `proposed`/`unresolved`, any unpriced leaf, any valuation outside policy bounds, pin older than `max_block_age_s` |
| `export_nav_report` | `dag_id` | `{json_url, html_url}` | JSON bundle (report, nodes, evidence, policy at digest, pin) and rendered HTML |
| `stage_reallocation` | `dag_id, allocations[]` | route: `evm_stage_tx` with structured encode args | explicit allocations only; `encode_reallocate` asserts byte identity against the staged calldata afterwards |

Secrets: `LIQSTEWARD_BFF_URL`, `LIQSTEWARD_BFF_TOKEN`, application-level, both required.

## 10. Skills

Three activation-only skills, one per phase, activated when the phase starts and deactivated when it ends:

- `nav-oracle/traversal`: open, expand, relay, write; retry rules; never compute.
- `nav-oracle/accounting`: fetch policy, chain prices as nodes, `price_nodes`, posted views, `compile_nav`, export.
- `nav-oracle/postconditions`: `sim_open` at the pin, `stage_reallocation`, `sim_apply` with the copied id, post-DAG through `sim_call`, `compile_nav`, `sim_close`. Guard: pilot vault, `reallocate` selector, chain 1.

Sources: `aomi-app/nav-oracle/src/skill/`.

## 11. Server and dashboard

Routes in `apps/api`, service-token bearer auth plus `x-aomi-session`, session ownership checked on every write:

| Route | Caller | Purpose |
|---|---|---|
| `POST /api/nav/dags` | plugin | mint `dag_id`, pin, freeze policy, create roots |
| `GET /api/nav/dags/:id` | both | DAG + nodes + edges |
| `POST /api/nav/dags/:id/nodes/:nid/plan` | plugin | record `expected_reads` |
| `POST /api/nav/dags/:id/nodes` | plugin | idempotent upsert by `node_id` |
| `POST /api/nav/dags/:id/price` | plugin | resolve `ext:` sources, write valuations |
| `POST /api/nav/dags/:id/compile` | plugin | fold, checks, persist report, open breaks |
| `GET /api/nav/dags/:id/export.(json|html)` | both | evidence bundle |
| `GET /api/nav/dags/:id/events` | dashboard | SSE `node.written`, `node.priced`, `dag.compiled`, `break.opened`; `Last-Event-ID` resume; function `maxDuration` 300 |
| `GET /api/nav/policies/:vault` | both | latest or `?policy_id&version` |
| `POST /api/nav/policies` | dashboard | validate, digest, store immutable version |
| `PATCH /api/nav/breaks/:id` | dashboard | status + note, `changed_by`, timestamp |

Store: Postgres via the Vercel marketplace, Drizzle schema `dags, nodes, edges, evidence, policies, reports, breaks`. The Aomi relay takes the app from a path prefix (`/api/aomi/liqsteward/*`, `/api/aomi/nav-oracle/*`); the config endpoint returns both application ids; the status cache becomes a map keyed by app.

Dashboard: `ControlRoom` becomes `NavOracle`. DAG in the middle, node inspector (evidence, keccak, decode), policy page (upload, digest, catalog), NAV and break queue, Aomi widget beside the DAG.

Report and breaks:

```ts
interface NavReport {
  dag_id: DagId; phase: "pre" | "post"; pin; policy_digest: Sha256; dag_digest: Sha256;
  base_asset: { symbol: string; decimals: number };
  totals: { assets_base: string; liabilities_base: string; nav_base: string; nav_usd?: string };
  positions: Array<{ node_id: NodeId; kind: NodeKind; quantity: string; value_base: string; source: string }>;
  checks: Array<{ id: string; posted_view: string; verdict: "pass" | "fail"; observed: string; posted: string; delta_bps: number }>;
  unresolved_in_scope: 0;
  generated_at: ISO8601;
}
interface Break {
  break_id: string; dag_id: DagId;
  kind: "reconciliation" | "price_deviation" | "stale_price" | "unpriced" | "unresolved_in_scope" | "conservation" | "residual_exposure";
  check_id?: string; severity: "info" | "warn" | "critical";
  observed: string; bound: string; node_ids: NodeId[];
  status: "open" | "explained" | "resolved";
  history: Array<{ status: string; changed_by: string; at: ISO8601; note?: string }>;
}
```

Server invariants: one pin per DAG and every `served_block` equals it; `quantity` and `valuation` are written only by the server from plugin-verified evidence; `node_id` is deterministic so retries upsert; policy versions are immutable; a post DAG carries `world.block_hash == pin.block_hash` before any write.

## 12. Milestones

0. **Step zero (done).** `aomi-app/` is a Cargo workspace: `liqsteward` (SDK 5.0.0, unchanged route on `evm-core`), `liqsteward-core` (transport, abi, morpho, bff, testing), `nav-oracle`. `.aomi/config.json` lists both apps. Deploy token must be project-scoped.
1. **Server foundation (done).** Postgres + Drizzle schema (`apps/api/drizzle/0000_init.sql`), policies, dags, nodes, price, compile, export, SSE events, breaks; pilot policy fixture seeded at boot; relay split by app path prefix.
2. **Traversal (done).** `open_valuation`, `expand_node`, `write_to_dag`; adapters `metamorpho_vault` (two stages), `morpho_blue_market` (two stages), `erc20_balance`, `erc4626_generic`. `NavOracle` dashboard with DAG view, node inspector, policy page, NAV and breaks, widget beside the DAG, SSE live updates.
3. **Accounting (done).** `get_accounting_policy`, `price_nodes` (`policy:par`, `ext:coingecko`, manual valuations), posted views, `compile_nav`, `export_nav_report` (JSON + HTML), break queue with status and note.
4. **Post-state (built, not yet driven end to end).** `stage_reallocation`, post-phase `open_valuation` with the world stamp, `sim_call` evidence, residual-exposure checks and breaks.

Verification on 2026-09-10:

- Unit: `cargo test --workspace` in `aomi-app/` (liqsteward 10, liqsteward-core 20, nav-oracle 6 incl. an FFI load of the built cdylib); `npm test` (core 6, api 17).
- Host harness on live chain: `nav-oracle/tests/e2e_pinned.rs` plays the host with real `eth_call`s at head−2, drives all eight tools, and asserts compile, checks, export, and a refused retyped nibble. Result: 25 node writes, 76 pinned reads, shadow NAV 3,788,567 USDC vs posted 3,788,572 USDC, `vault_total_assets` delta 0 bps, every per-node check pass.
- Host-in-the-loop: the cdylib loads on `aomi-cli` built from product-mono `origin/main`; the model sees `evm-reads`, `evm-sim`, `activate_skills`, and the eight NAV tools and nothing else. A real model then drove the whole flow (`dag_mtvf23mb91c463aefaa8`, block 25,946,549): 13 nodes, one `transport_invalid_hex` refusal on a 192-byte `market(bytes32)` result that the model corrected by re-reading, 12 positions priced, NAV 3,788,578.696104 USDC, 13 checks passing at 0 bps, no breaks. The host caps a turn (`execution_limit_reached` after roughly 45 tool calls), so a full valuation is a multi-turn conversation; `expand_node` without `node_id` resumes from the server's frontier after a turn boundary.

Two platform findings from that run, recorded for the platform team: the SDK digests guard tables through `serde_json` map order, so a plugin must enable `serde_json/preserve_order` to match the host (see `aomi-app/Cargo.toml`); and the CLI's provider bootstrap fails silently on the repo's full `providers.toml`, so local runs use a minimal single-fork file.

Testing going forward: unit tests in CI per crate; the host harness against a running API as a documented manual step; the CLI run as the pre-release check.

## 13. Future

- **Agentic policy authoring.** The user describes their accounting practice in chat; the agent drafts the policy JSON against the schema and the adapter catalog; the user reviews and uploads. The schema does not change.
- **IDE layout.** Chat on the side, the DAG in the middle, a control bar for pin, policy version, phase, and export. `NavOracle` with the widget beside the DAG is the first step.
- **Per-user service tokens.** The secret override layer means moving from application-level to per-user tokens needs no plugin change.
- **Pendle PT and other adapters.** Each is a new adapter plus catalog entries; nothing else moves.
- **Attested manual valuations.** EIP-712 over the entry once a second party needs to trust it.
