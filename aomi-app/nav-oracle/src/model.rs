//! Wire types shared with the LiqSteward backend (`apps/api/src/nav/types.ts`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Evidence {
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    pub target: String,
    pub function_signature: String,
    pub arguments: Vec<String>,
    pub served_block: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    pub result_keccak: String,
    pub raw_result: String,
    pub decoded_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Quantity {
    pub raw: String,
    pub decimals: u8,
    pub symbol: String,
    pub asset: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BaseAsset {
    pub address: String,
    pub symbol: String,
    pub decimals: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PostedView {
    pub view_id: String,
    pub value_raw: String,
    pub evidence_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChildHint {
    pub kind: String,
    pub contract: String,
    pub account: String,
    pub adapter_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Semantic {
    pub protocol: String,
    pub adapter_id: String,
    pub adapter_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExpectedRead {
    pub function_signature: String,
    pub arguments: Vec<String>,
    pub target: String,
}

/// The subset of a server node the plugin acts on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub node_id: String,
    pub dag_id: String,
    pub kind: String,
    pub status: String,
    pub chain_id: u64,
    pub contract: String,
    pub account: String,
    #[serde(default)]
    pub market_id: Option<String>,
    pub semantic: Semantic,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub child_hints: Vec<ChildHint>,
    pub stage: u32,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub unresolved: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DagPin {
    pub block_number: u64,
    pub block_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DagPolicyRef {
    pub policy_id: String,
    pub version: u32,
    pub digest: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Dag {
    pub dag_id: String,
    pub phase: String,
    pub status: String,
    pub pin: DagPin,
    pub policy: DagPolicyRef,
}

/// One node write, mirroring `NodeWriteBody` on the server.
#[derive(Debug, Clone, Serialize)]
pub struct NodeWrite {
    pub node_id: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unresolved: Option<Unresolved>,
    pub stage: u32,
    pub stage_complete: bool,
    pub evidence: Vec<Evidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<Quantity>,
    pub semantic: Semantic,
    pub posted_views: Vec<PostedView>,
    pub child_hints: Vec<ChildHint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_asset: Option<BaseAsset>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Unresolved {
    pub reason: &'static str,
    pub detail: String,
}
