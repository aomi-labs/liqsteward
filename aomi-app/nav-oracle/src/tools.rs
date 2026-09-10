//! The NAV Oracle tool surface. Every tool is a thin, verifying bridge
//! between what the agent relays and what the backend stores; none of them
//! reads the chain.

use crate::NavOracle;
use crate::adapters::{self, Adapter, NodeCtx, VerifiedRead};
use crate::model::{Evidence, Node, NodeWrite, Semantic, Unresolved};
use crate::server::NavServer;
use aomi_sdk::{DynAomiTool, DynToolCallCtx, ToolReturn, schemars::JsonSchema, serde_json::{Value, json}};
use liqsteward_core::morpho::{Allocation, CHAIN_ID, REALLOCATE_SIGNATURE, encode_reallocate, reallocate_stage_data};
use liqsteward_core::transport::{keccak_hex, verify_result};
use serde::Deserialize;

const ENCODE_AND_CALL: &str = "encode_and_call";
const SIM_CALL: &str = "sim_call";
const EVM_STAGE_TX: &str = "evm_stage_tx";
const READ_TOPIC: &str = "nav-oracle pinned read";

fn ctx_for<'a>(node: &'a Node) -> NodeCtx<'a> {
    NodeCtx {
        kind: &node.kind,
        contract: &node.contract,
        account: &node.account,
        market_id: node.market_id.as_deref(),
        prior: &node.evidence,
    }
}

const MAX_ATTEMPTS: u32 = 3;
const RETRYABLE_REASONS: [&str; 6] = [
    "transport_digest_mismatch",
    "transport_invalid_hex",
    "read_oversized",
    "served_block_mismatch",
    "world_hash_mismatch",
    "read_incomplete",
];

/// A node the agent may (re-)expand: proposed, or unresolved for a transport
/// reason with attempts left. Adapter and decode failures are not retried.
fn expandable(node: &Node) -> bool {
    if node.status == "proposed" {
        return true;
    }
    if node.status != "unresolved" || node.attempts >= MAX_ATTEMPTS {
        return false;
    }
    node.unresolved
        .as_ref()
        .and_then(|value| value.get("reason"))
        .and_then(|value| value.as_str())
        .is_some_and(|reason| RETRYABLE_REASONS.contains(&reason))
}

fn adapter_for(node: &Node) -> Result<Box<dyn Adapter>, String> {
    adapters::by_id(&node.semantic.adapter_id)
        .ok_or_else(|| format!("node {} names adapter `{}`, which this build does not ship", node.node_id, node.semantic.adapter_id))
}

/// Route steps that perform the plan's reads at the DAG's pin. Pre-phase
/// reads go through `encode_and_call{block_tag}`; post-phase reads go
/// through `sim_call` inside the session world.
fn read_steps(dag_phase: &str, pin_block: u64, chain_id: u64, reads: &[crate::model::ExpectedRead]) -> Vec<(&'static str, Value)> {
    reads
        .iter()
        .map(|read| {
            if dag_phase == "post" {
                (
                    SIM_CALL,
                    json!({
                        "function_signature": read.function_signature,
                        "arguments": read.arguments,
                        "to": read.target,
                        "chain_id": chain_id,
                        "topic": READ_TOPIC,
                    }),
                )
            } else {
                (
                    ENCODE_AND_CALL,
                    json!({
                        "function_signature": read.function_signature,
                        "arguments": read.arguments,
                        "to": read.target,
                        "chain_id": chain_id,
                        "block_tag": pin_block.to_string(),
                        "from": "0x0000000000000000000000000000000000000001",
                        "topic": READ_TOPIC,
                    }),
                )
            }
        })
        .collect()
}

fn expand_route(server: &NavServer, dag_id: &str, node: Node) -> Result<ToolReturn, String> {
    let (dag, _) = server.dag(dag_id)?;
    if dag.status != "open" {
        return Err(format!("dag {dag_id} is {}; open a new valuation", dag.status));
    }
    if !expandable(&node) {
        return Ok(ToolReturn::value(json!({
            "node_id": node.node_id,
            "status": node.status,
            "unresolved": node.unresolved,
            "attempts": node.attempts,
            "note": "this node is not expandable: it is already written, excluded, out of retries, or failed for a non-transport reason",
        })));
    }
    let adapter = adapter_for(&node)?;
    let reads = adapter.plan(&ctx_for(&node), node.stage).map_err(|error| error.to_string())?;
    if reads.is_empty() {
        return Err(format!("adapter {} has no reads for stage {} of node {}", adapter.id(), node.stage, node.node_id));
    }
    let planned = server.plan(dag_id, &node.node_id, node.stage, &reads)?;
    let steps = read_steps(&dag.phase, dag.pin.block_number, node.chain_id, &reads);
    let preview = json!({
        "dag_id": dag_id,
        "node_id": planned.node_id,
        "kind": planned.kind,
        "adapter": format!("{}@{}", adapter.id(), adapter.version()),
        "stage": planned.stage,
        "pin": { "block_number": dag.pin.block_number, "block_hash": dag.pin.block_hash },
        "phase": dag.phase,
        "reads": reads,
        "then": format!(
            "call write_to_dag {{ dag_id, node_id, stage: {}, reads: [...] }} with every read's function_signature, arguments, target, served_block, result_keccak, raw_result{} copied verbatim from the host results",
            planned.stage,
            if dag.phase == "post" { ", block_hash, seq" } else { "" }
        ),
    });
    let write_args = json!({
        "dag_id": dag_id,
        "node_id": planned.node_id,
        "stage": planned.stage,
        "reads": [],
    });
    let stage = planned.stage;
    Ok(ToolReturn::route(preview)
        .next(|next| {
            for (tool, args) in steps {
                next.add_named(tool, args)
                    .note("Pinned read. Do not alter the arguments; relay result, result_keccak, and served_block exactly.");
            }
            next.add_named(WriteToDag::NAME, write_args)
                .note(format!("Fill `reads` with every read above for stage {stage}, one entry per read, values copied verbatim."));
        })
        .build())
}

// ── open_valuation ──

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OpenValuationArgs {
    /// Vault address to value.
    pub vault: String,
    /// EVM chain id (1 for Ethereum mainnet).
    pub chain_id: u64,
    /// Policy id to bind; defaults to the latest policy uploaded for the vault.
    #[serde(default)]
    pub policy_id: Option<String>,
    /// Block number to pin. Defaults to the chain head minus a safety depth.
    #[serde(default)]
    pub block: Option<u64>,
    /// "pre" (default) values live state; "post" values a session world after sim_apply.
    #[serde(default)]
    pub phase: Option<String>,
    /// Post phase only: the pre-state dag this post-state belongs to.
    #[serde(default)]
    pub parent_dag_id: Option<String>,
    /// Post phase only: `sim.block_hash` from the sim_apply result.
    #[serde(default)]
    pub world_block_hash: Option<String>,
    /// Post phase only: `applied_ids` from the sim_apply result.
    #[serde(default)]
    pub applied_ids: Option<Vec<String>>,
    /// Post phase only: `sim.seq` from the sim_apply result.
    #[serde(default)]
    pub seq: Option<u64>,
    /// Post phase only: market ids whose remaining supply is the residual exposure.
    #[serde(default)]
    pub risk_market_ids: Option<Vec<String>>,
    /// Post phase only: the largest acceptable residual supply across risk markets, in base units.
    #[serde(default)]
    pub max_residual_assets: Option<String>,
}

pub struct OpenValuation;
impl DynAomiTool for OpenValuation {
    type App = NavOracle;
    type Args = OpenValuationArgs;
    const NAME: &'static str = "open_valuation";
    const DESCRIPTION: &'static str = "Open a block-pinned valuation session for a vault under its accounting policy. Mints a dag_id, pins the block, creates the root account nodes, and routes the first expansion. Post phase requires the sim world stamp from sim_apply.";

    fn run_with_routes(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<ToolReturn, String> {
        let server = NavServer::from_ctx(&ctx)?;
        let phase = args.phase.clone().unwrap_or_else(|| "pre".to_owned());
        let mut body = json!({
            "vault": args.vault.to_lowercase(),
            "chain_id": args.chain_id,
            "policy_id": args.policy_id,
            "block": args.block,
            "phase": phase,
            "parent_dag_id": args.parent_dag_id,
        });
        if phase == "post" {
            body["world"] = json!({
                "block_hash": args.world_block_hash,
                "applied_ids": args.applied_ids.unwrap_or_default(),
                "seq": args.seq.unwrap_or(0),
            });
            if let (Some(ids), Some(max)) = (args.risk_market_ids, args.max_residual_assets) {
                body["plan"] = json!({ "risk_market_ids": ids, "max_residual_assets": max });
            }
        }
        let (dag, roots) = server.open_dag(&body)?;
        let first = roots.iter().find(|node| node.status == "proposed").cloned();
        let preview = json!({
            "dag_id": dag.dag_id,
            "phase": dag.phase,
            "pin": { "block_number": dag.pin.block_number, "block_hash": dag.pin.block_hash },
            "policy": { "policy_id": dag.policy.policy_id, "version": dag.policy.version, "digest": dag.policy.digest },
            "roots": roots.iter().map(|node| json!({
                "node_id": node.node_id, "kind": node.kind, "status": node.status,
                "contract": node.contract, "adapter_id": node.semantic.adapter_id, "unresolved": node.unresolved,
            })).collect::<Vec<_>>(),
            "next": "expand each proposed root, follow the reads, write_to_dag, repeat for every child until the frontier is empty",
        });
        match first {
            Some(root) => {
                let dag_id = dag.dag_id.clone();
                Ok(ToolReturn::route(preview)
                    .next(|next| {
                        next.add_named(ExpandNode::NAME, json!({ "dag_id": dag_id, "node_id": root.node_id }))
                            .note("The first expansion doubles as the archive probe: totalAssets() at the pin.");
                    })
                    .build())
            }
            None => Ok(ToolReturn::value(preview)),
        }
    }
}

// ── get_accounting_policy ──

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetAccountingPolicyArgs {
    /// Vault address the policy governs.
    pub vault: String,
    /// Specific policy id; defaults to the latest uploaded for the vault.
    #[serde(default)]
    pub policy_id: Option<String>,
    /// Specific version; defaults to the latest version of the policy.
    #[serde(default)]
    pub version: Option<u32>,
}

pub struct GetAccountingPolicy;
impl DynAomiTool for GetAccountingPolicy {
    type App = NavOracle;
    type Args = GetAccountingPolicyArgs;
    const NAME: &'static str = "get_accounting_policy";
    const DESCRIPTION: &'static str = "Load the user-uploaded accounting policy (scope, adapters, pricing, exclusions, manual valuations, reconciliation checks) with its digest and the posted-view catalog. Policy decisions come from here, never from prose.";

    fn run(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let server = NavServer::from_ctx(&ctx)?;
        server.policy(&args.vault.to_lowercase(), args.policy_id.as_deref(), args.version)
    }
}

// ── expand_node ──

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExpandNodeArgs {
    pub dag_id: String,
    /// The node to expand. Omit it to take the next expandable node from the
    /// server's frontier (useful after a resumed conversation).
    #[serde(default)]
    pub node_id: Option<String>,
}

pub struct ExpandNode;
impl DynAomiTool for ExpandNode {
    type App = NavOracle;
    type Args = ExpandNodeArgs;
    const NAME: &'static str = "expand_node";
    const DESCRIPTION: &'static str = "Author the read plan for one proposed node: the adapter decides which functions to call at the pinned block, the server records what it expects back, and the route performs the reads. Follow the route exactly, then call write_to_dag. Omit node_id to take the next node from the frontier.";

    fn run_with_routes(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<ToolReturn, String> {
        let server = NavServer::from_ctx(&ctx)?;
        let node = match args.node_id {
            Some(node_id) => server.node(&args.dag_id, &node_id)?,
            None => {
                let (_, nodes) = server.dag(&args.dag_id)?;
                match nodes.into_iter().find(expandable) {
                    Some(node) => node,
                    None => {
                        return Ok(ToolReturn::value(json!({
                            "dag_id": args.dag_id,
                            "frontier_empty": true,
                            "next": "activate nav-oracle/accounting, then price_nodes and compile_nav for this dag",
                        })));
                    }
                }
            }
        };
        expand_route(&server, &args.dag_id, node)
    }
}

// ── write_to_dag ──

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct RelayedRead {
    /// Exactly as sent to the host, e.g. "position(bytes32,address)".
    pub function_signature: String,
    /// Exactly as sent to the host.
    pub arguments: Vec<String>,
    /// Contract address the read targeted.
    pub target: String,
    /// `served_block` from the host result.
    pub served_block: u64,
    /// `result_keccak` from the host result, verbatim.
    pub result_keccak: String,
    /// `result` from the host result, verbatim 0x hex.
    pub raw_result: String,
    /// Post phase only: `sim.block_hash` from the host result.
    #[serde(default)]
    pub block_hash: Option<String>,
    /// Post phase only: `sim.seq` from the host result.
    #[serde(default)]
    pub seq: Option<u64>,
    /// The host tool call id, when known.
    #[serde(default)]
    pub call_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct WriteToDagArgs {
    pub dag_id: String,
    pub node_id: String,
    /// The stage the reads belong to, from expand_node.
    pub stage: u32,
    /// Every read of the stage, values copied verbatim from host results.
    pub reads: Vec<RelayedRead>,
}

pub struct WriteToDag;
impl DynAomiTool for WriteToDag {
    type App = NavOracle;
    type Args = WriteToDagArgs;
    const NAME: &'static str = "write_to_dag";
    const DESCRIPTION: &'static str = "Verify relayed reads byte-for-byte against the host's keccak stamps, decode them with the node's adapter, and write the node. All-or-nothing per stage. A mismatch leaves the node unresolved with the reason; re-run that node's reads and write again.";

    fn run_with_routes(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<ToolReturn, String> {
        let server = NavServer::from_ctx(&ctx)?;
        let (dag, _) = server.dag(&args.dag_id)?;
        let node = server.node(&args.dag_id, &args.node_id)?;
        let adapter = adapter_for(&node)?;
        let decoded_by = adapters::decoded_by(adapter.as_ref());
        let source = if dag.phase == "post" { "evm_sim" } else { "evm_reads" };

        let semantic = Semantic {
            protocol: adapter.protocol().to_owned(),
            adapter_id: adapter.id().to_owned(),
            adapter_version: adapter.version().to_owned(),
            interface: node.semantic.interface.clone(),
        };
        let unresolved = |reason: &'static str, detail: String| NodeWrite {
            node_id: node.node_id.clone(),
            status: "unresolved",
            unresolved: Some(Unresolved { reason, detail }),
            stage: args.stage,
            stage_complete: false,
            evidence: vec![],
            quantity: None,
            semantic: semantic.clone(),
            posted_views: vec![],
            child_hints: vec![],
            base_asset: None,
        };

        if node.stage != args.stage {
            return Err(format!("node {} is at stage {}, not {}; call expand_node first", node.node_id, node.stage, args.stage));
        }

        // 1. Byte identity for every relayed read.
        let mut verified = Vec::with_capacity(args.reads.len());
        let mut evidence = Vec::with_capacity(args.reads.len());
        for read in &args.reads {
            let bytes = match verify_result(&read.raw_result, &read.result_keccak) {
                Ok(bytes) => bytes,
                Err(error) => {
                    let (written, _) = server.write(&args.dag_id, &unresolved(error.reason(), format!("{}: {error}", read.function_signature)))?;
                    return Ok(ToolReturn::value(json!({ "node": written, "verdict": "unresolved", "reason": error.reason(), "detail": error.to_string() })));
                }
            };
            if read.served_block != dag.pin.block_number {
                let (written, _) = server.write(&args.dag_id, &unresolved("served_block_mismatch", format!("{} served at {}, pin is {}", read.function_signature, read.served_block, dag.pin.block_number)))?;
                return Ok(ToolReturn::value(json!({ "node": written, "verdict": "unresolved", "reason": "served_block_mismatch" })));
            }
            verified.push(VerifiedRead {
                function_signature: read.function_signature.clone(),
                arguments: read.arguments.clone(),
                target: read.target.to_lowercase(),
                bytes,
            });
            evidence.push(Evidence {
                source: source.to_owned(),
                call_id: read.call_id.clone(),
                target: read.target.to_lowercase(),
                function_signature: read.function_signature.clone(),
                arguments: read.arguments.clone(),
                served_block: read.served_block,
                block_hash: read.block_hash.clone(),
                seq: read.seq,
                result_keccak: read.result_keccak.to_lowercase(),
                raw_result: read.raw_result.to_lowercase(),
                decoded_by: decoded_by.clone(),
            });
        }

        // 2. Completeness against the adapter's own plan.
        let plan = adapter.plan(&ctx_for(&node), node.stage).map_err(|error| error.to_string())?;
        let missing = plan
            .iter()
            .filter(|expected| !verified.iter().any(|read| read.function_signature == expected.function_signature && read.arguments == expected.arguments && read.target == expected.target))
            .map(|expected| format!("{}({})", expected.function_signature, expected.arguments.join(",")))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            let (written, _) = server.write(&args.dag_id, &unresolved("read_incomplete", format!("missing {}", missing.join(", "))))?;
            return Ok(ToolReturn::value(json!({ "node": written, "verdict": "unresolved", "reason": "read_incomplete", "missing": missing })));
        }

        // 3. Decode.
        let decoded = match adapter.decode(&ctx_for(&node), node.stage, &verified) {
            Ok(decoded) => decoded,
            Err(error) => {
                let (written, _) = server.write(&args.dag_id, &unresolved(error.reason(), error.to_string()))?;
                return Ok(ToolReturn::value(json!({ "node": written, "verdict": "unresolved", "reason": error.reason(), "detail": error.to_string() })));
            }
        };

        let body = NodeWrite {
            node_id: node.node_id.clone(),
            status: "verified",
            unresolved: None,
            stage: args.stage,
            stage_complete: decoded.stage_complete,
            evidence,
            quantity: decoded.quantity,
            semantic: Semantic { interface: decoded.interface.map(str::to_owned).or(semantic.interface), ..semantic },
            posted_views: decoded.posted_views,
            child_hints: decoded.child_hints,
            base_asset: decoded.base_asset,
        };
        let (written, children) = server.write(&args.dag_id, &body)?;
        let summary = json!({
            "node": { "node_id": written.node_id, "kind": written.kind, "status": written.status, "stage": written.stage, "unresolved": written.unresolved },
            "verdict": if written.status == "unresolved" { "unresolved" } else if decoded.stage_complete { "verified" } else { "stage_written" },
            "children": children.iter().map(|child| json!({ "node_id": child.node_id, "kind": child.kind, "status": child.status, "contract": child.contract, "market_id": child.market_id })).collect::<Vec<_>>(),
        });
        if written.status == "unresolved" {
            return Ok(ToolReturn::value(summary));
        }
        let dag_id = args.dag_id.clone();
        if !decoded.stage_complete {
            let node_id = written.node_id.clone();
            return Ok(ToolReturn::route(summary)
                .next(|next| {
                    next.add_named(ExpandNode::NAME, json!({ "dag_id": dag_id, "node_id": node_id }))
                        .note("This node has another stage; expand it again.");
                })
                .build());
        }
        // One next step, never a fan-out: routing every child at once invites
        // the model to open more reads than it will carry back. The server's
        // frontier is the queue; the first proposed node is next.
        let (_, nodes) = server.dag(&dag_id)?;
        let frontier = nodes.iter().filter(|node| expandable(node)).map(|node| node.node_id.clone()).collect::<Vec<_>>();
        let mut summary = summary;
        summary["frontier_remaining"] = json!(frontier.len());
        match frontier.first() {
            None => {
                summary["frontier_empty"] = json!(true);
                summary["next"] = json!("activate nav-oracle/accounting, then price_nodes and compile_nav for this dag");
                Ok(ToolReturn::value(summary))
            }
            Some(next_id) => {
                let next_id = next_id.clone();
                Ok(ToolReturn::route(summary)
                    .next(|next| {
                        next.add_named(ExpandNode::NAME, json!({ "dag_id": dag_id, "node_id": next_id }))
                            .note("Next proposed node. Expand it, do its reads, write it, and only then move on.");
                    })
                    .build())
            }
        }
    }
}

// ── price_nodes ──

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PriceNodesArgs {
    pub dag_id: String,
    /// Restrict to these nodes; defaults to every verified node with a quantity.
    #[serde(default)]
    pub node_ids: Option<Vec<String>>,
}

pub struct PriceNodes;
impl DynAomiTool for PriceNodes {
    type App = NavOracle;
    type Args = PriceNodesArgs;
    const NAME: &'static str = "price_nodes";
    const DESCRIPTION: &'static str = "Value verified nodes under the policy's pricing rules in the vault's base asset. Returns priced node ids and the reason for every node that stays unpriced.";

    fn run(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let server = NavServer::from_ctx(&ctx)?;
        server.price(&args.dag_id, args.node_ids.as_deref())
    }
}

// ── compile_nav ──

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompileNavArgs {
    pub dag_id: String,
}

pub struct CompileNav;
impl DynAomiTool for CompileNav {
    type App = NavOracle;
    type Args = CompileNavArgs;
    const NAME: &'static str = "compile_nav";
    const DESCRIPTION: &'static str = "Fold the priced DAG into a NAV report, run the policy-selected reconciliation checks, and open breaks. Refuses, listing the blocking nodes, while any in-scope node is unverified or unpriced.";

    fn run(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let server = NavServer::from_ctx(&ctx)?;
        match server.compile(&args.dag_id)? {
            Ok(value) => Ok(json!({ "compiled": true, "report": value["report"], "breaks": value["breaks"] })),
            Err(refusal) => Ok(json!({ "compiled": false, "refused": refusal["refused"], "blocking": refusal["blocking"] })),
        }
    }
}

// ── export_nav_report ──

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExportNavReportArgs {
    pub dag_id: String,
}

pub struct ExportNavReport;
impl DynAomiTool for ExportNavReport {
    type App = NavOracle;
    type Args = ExportNavReportArgs;
    const NAME: &'static str = "export_nav_report";
    const DESCRIPTION: &'static str = "Return the evidence bundle links for a valuation: JSON (report, every node with evidence, the policy at its digest, the pin) and a rendered HTML summary.";

    fn run(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<Value, String> {
        let server = NavServer::from_ctx(&ctx)?;
        let (dag, nodes) = server.dag(&args.dag_id)?;
        Ok(json!({
            "dag_id": dag.dag_id,
            "status": dag.status,
            "pin": { "block_number": dag.pin.block_number, "block_hash": dag.pin.block_hash },
            "nodes": nodes.len(),
            "json_url": format!("{}/api/nav/dags/{}/export.json", server.base_url(), dag.dag_id),
            "html_url": format!("{}/api/nav/dags/{}/export.html", server.base_url(), dag.dag_id),
        }))
    }
}

// ── stage_reallocation ──

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct AllocationArgs {
    pub loan_token: String,
    pub collateral_token: String,
    pub oracle: String,
    pub irm: String,
    /// Decimal string.
    pub lltv: String,
    /// Target assets in base units, decimal string; use type(uint256).max for the last entry to sweep the remainder.
    pub assets: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct StageReallocationArgs {
    /// The compiled pre-state dag this reallocation is evaluated against.
    pub dag_id: String,
    /// MetaMorpho vault to reallocate.
    pub vault: String,
    /// Explicit allocation targets, in order. No planning happens here.
    pub allocations: Vec<AllocationArgs>,
}

pub struct StageReallocation;
impl DynAomiTool for StageReallocation {
    type App = NavOracle;
    type Args = StageReallocationArgs;
    const NAME: &'static str = "stage_reallocation";
    const DESCRIPTION: &'static str = "Stage a MetaMorpho reallocate call with explicit allocations through evm_stage_tx using structured encode args, for sim_apply inside the session world. Never commits, signs, or broadcasts.";

    fn run_with_routes(_app: &NavOracle, args: Self::Args, ctx: DynToolCallCtx) -> Result<ToolReturn, String> {
        let server = NavServer::from_ctx(&ctx)?;
        let (dag, _) = server.dag(&args.dag_id)?;
        if dag.phase != "pre" {
            return Err("stage_reallocation takes the pre-state dag id".to_owned());
        }
        if args.allocations.is_empty() {
            return Err("allocations must not be empty".to_owned());
        }
        let allocations = args
            .allocations
            .iter()
            .map(|entry| Allocation {
                loan_token: entry.loan_token.to_lowercase(),
                collateral_token: entry.collateral_token.to_lowercase(),
                oracle: entry.oracle.to_lowercase(),
                irm: entry.irm.to_lowercase(),
                lltv: entry.lltv.clone(),
                assets: entry.assets.clone(),
            })
            .collect::<Vec<_>>();
        let calldata = encode_reallocate(&allocations).map_err(|error| error.to_string())?;
        let data = reallocate_stage_data(&allocations).map_err(|error| error.to_string())?;
        let calldata_bytes = liqsteward_core::transport::decode_hex("calldata", &calldata).map_err(|error| error.to_string())?;
        let market_ids = allocations
            .iter()
            .map(|allocation| allocation.market_id().map(|id| format!("{id:#x}")))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let stage_args = json!({
            "to": args.vault.to_lowercase(),
            "chain_id": CHAIN_ID,
            "description": format!("NAV oracle post-state probe: reallocate {} markets on {}", allocations.len(), args.vault.to_lowercase()),
            "data": data,
            "value": "0",
            "kind": "nav_oracle_reallocation_probe",
            "protocol": "morpho",
            "topic": "nav-oracle stage reallocation",
        });
        let preview = json!({
            "pre_dag_id": dag.dag_id,
            "pin": { "block_number": dag.pin.block_number, "block_hash": dag.pin.block_hash },
            "signature": REALLOCATE_SIGNATURE,
            "market_ids": market_ids,
            "calldata_keccak": keccak_hex(&calldata_bytes),
            "calldata_bytes": calldata_bytes.len(),
            "then": [
                "sim_open { chain_ids: [1], block: \"<pin.block_number>\" } — the world's sim.block_hash must equal the pin",
                "follow the evm_stage_tx step; note the pending_tx_id it mints",
                "sim_apply { transactions: [{ id: <pending_tx_id>, kind: \"nav_oracle_reallocation_probe\", label: \"reallocation probe\" }] }",
                "open_valuation { vault, chain_id, phase: \"post\", parent_dag_id, block: <pin>, world_block_hash, applied_ids, seq, risk_market_ids, max_residual_assets }",
            ],
            "explicitly_absent": ["evm_commit_txs", "signature", "broadcast"],
        });
        Ok(ToolReturn::route(preview)
            .next(|next| {
                next.add_named(EVM_STAGE_TX, stage_args)
                    .note("Stage exactly these structured encode args. Do not commit. Then sim_apply the minted id inside the open world.");
            })
            .build())
    }
}
