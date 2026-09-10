//! Adapters: one per contract shape. An adapter authors the read plan for a
//! node stage, and decodes the verified bytes of that stage into a quantity,
//! posted views, and the next hop. Adapters are reviewed code; the policy
//! only selects which ones may run and which posted views to check.

mod erc20;
mod erc4626;
mod metamorpho;
mod morpho_market;

use crate::model::{BaseAsset, ChildHint, Evidence, ExpectedRead, PostedView, Quantity};
use liqsteward_core::abi::DecodeError;
use std::fmt;

pub use erc20::Erc20Balance;
pub use erc4626::Erc4626Generic;
pub use metamorpho::MetaMorphoVault;
pub use morpho_market::MorphoBlueMarket;

/// What the adapter knows about the node it is expanding.
pub struct NodeCtx<'a> {
    pub kind: &'a str,
    pub contract: &'a str,
    pub account: &'a str,
    pub market_id: Option<&'a str>,
    /// Evidence from earlier stages, already verified by the server.
    pub prior: &'a [Evidence],
}

/// A verified read of the current stage: the bytes hash to the host stamp.
pub struct VerifiedRead {
    pub function_signature: String,
    pub arguments: Vec<String>,
    pub target: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct Decoded {
    pub quantity: Option<Quantity>,
    pub posted_views: Vec<PostedView>,
    pub child_hints: Vec<ChildHint>,
    pub base_asset: Option<BaseAsset>,
    pub interface: Option<&'static str>,
    pub stage_complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterError {
    /// The node kind or stage is outside what this adapter handles.
    NotApplicable(String),
    /// A read the plan required is missing from the relayed set.
    MissingRead(String),
    /// Bytes did not decode as the expected ABI shape.
    Decode(String),
}

impl fmt::Display for AdapterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotApplicable(detail) => write!(f, "adapter not applicable: {detail}"),
            Self::MissingRead(detail) => write!(f, "read incomplete: {detail}"),
            Self::Decode(detail) => write!(f, "probe failed: {detail}"),
        }
    }
}

impl From<DecodeError> for AdapterError {
    fn from(error: DecodeError) -> Self {
        Self::Decode(error.to_string())
    }
}

impl AdapterError {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::NotApplicable(_) => "adapter_unknown",
            Self::MissingRead(_) => "read_incomplete",
            Self::Decode(_) => "probe_failed",
        }
    }
}

pub trait Adapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str;
    fn protocol(&self) -> &'static str;
    /// Reads for `stage`. An empty plan means the node has no more stages.
    fn plan(&self, node: &NodeCtx<'_>, stage: u32) -> Result<Vec<ExpectedRead>, AdapterError>;
    /// Decode the verified reads of `stage`.
    fn decode(&self, node: &NodeCtx<'_>, stage: u32, reads: &[VerifiedRead]) -> Result<Decoded, AdapterError>;
}

pub fn by_id(id: &str) -> Option<Box<dyn Adapter>> {
    match id {
        "metamorpho_vault" => Some(Box::new(MetaMorphoVault)),
        "morpho_blue_market" => Some(Box::new(MorphoBlueMarket)),
        "erc20_balance" => Some(Box::new(Erc20Balance)),
        "erc4626_generic" => Some(Box::new(Erc4626Generic)),
        _ => None,
    }
}

pub fn decoded_by(adapter: &dyn Adapter) -> String {
    format!("{}@{}", adapter.id(), adapter.version())
}

// ── helpers shared by adapters ──

pub(crate) fn read(target: &str, signature: &str, arguments: Vec<String>) -> ExpectedRead {
    ExpectedRead {
        function_signature: signature.to_owned(),
        arguments,
        target: target.to_lowercase(),
    }
}

/// Find one verified read of this stage by signature and arguments.
pub(crate) fn find<'a>(reads: &'a [VerifiedRead], signature: &str, arguments: &[String]) -> Result<&'a VerifiedRead, AdapterError> {
    reads
        .iter()
        .find(|read| read.function_signature == signature && read.arguments == arguments)
        .ok_or_else(|| AdapterError::MissingRead(format!("{signature}({})", arguments.join(","))))
}

/// Find a prior-stage read, re-verifying the stamp before trusting its bytes.
pub(crate) fn prior(evidence: &[Evidence], signature: &str, arguments: &[String]) -> Result<Vec<u8>, AdapterError> {
    let entry = evidence
        .iter()
        .find(|item| item.function_signature == signature && item.arguments == arguments)
        .ok_or_else(|| AdapterError::MissingRead(format!("prior {signature}({})", arguments.join(","))))?;
    liqsteward_core::transport::verify_result(&entry.raw_result, &entry.result_keccak)
        .map_err(|error| AdapterError::Decode(format!("prior evidence for {signature} no longer verifies: {error}")))
}

pub(crate) fn hint(kind: &str, contract: &str, account: &str, adapter_id: &str, market_id: Option<String>) -> ChildHint {
    ChildHint {
        kind: kind.to_owned(),
        contract: contract.to_lowercase(),
        account: account.to_lowercase(),
        adapter_id: adapter_id.to_owned(),
        market_id,
    }
}
