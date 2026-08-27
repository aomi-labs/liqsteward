use aomi_sdk::schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Default)]
pub(crate) struct LiqStewardApp;

pub(crate) use crate::tool::*;

#[derive(Clone)]
pub(crate) struct LiqStewardClient {
    http: reqwest::blocking::Client,
}

impl LiqStewardClient {
    pub(crate) fn new() -> Result<Self, String> {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|error| format!("failed to build HTTP client: {error}"))?;
        Ok(Self { http })
    }

    pub(crate) fn get(&self, url: &str) -> Result<Value, String> {
        let response = self.send(self.http.get(url))?;
        self.decode(response)
    }

    pub(crate) fn post<T: Serialize>(&self, url: &str, body: &T) -> Result<Value, String> {
        let response = self.send(self.http.post(url).json(body))?;
        self.decode(response)
    }

    fn send(
        &self,
        request: reqwest::blocking::RequestBuilder,
    ) -> Result<reqwest::blocking::Response, String> {
        request
            .send()
            .map_err(|error| format!("LiqSteward API request failed: {error}"))
    }

    fn decode(&self, response: reqwest::blocking::Response) -> Result<Value, String> {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(format!("LiqSteward API returned {status}: {body}"));
        }
        serde_json::from_str(&body)
            .map_err(|error| format!("LiqSteward API decode failed: {error}"))
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NoArgs {}

impl JsonSchema for NoArgs {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "NoArgs".into()
    }

    fn json_schema(_generator: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": false
        })
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct VerifyTransactionArgs {
    /// Canonical Ethereum transaction hash (0x-prefixed, 32 bytes).
    pub(crate) hash: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct RiskSignalArgs {
    /// Manager or monitoring-system identifier for this alert.
    pub(crate) risk_signal_id: String,
    /// Morpho market ids whose vault exposure must be reduced.
    pub(crate) affected_market_ids: Vec<String>,
    /// Plain-language reason for the alert. This is evidence, not executable policy.
    pub(crate) reason: String,
    /// RFC3339 observation time supplied by the risk system.
    pub(crate) observed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub(crate) struct MarketParamsArgs {
    /// Vault loan asset address. Every allocation must use the same loan token.
    pub(crate) loan_token: String,
    /// Morpho market collateral token address. Use the zero address for the idle market.
    pub(crate) collateral_token: String,
    /// Morpho market oracle address. Use the zero address for the idle market.
    pub(crate) oracle: String,
    /// Morpho interest-rate-model address. Use the zero address for the idle market.
    pub(crate) irm: String,
    /// Liquidation LTV as a base-10 1e18-scaled integer string.
    pub(crate) lltv: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub(crate) struct AllocationTargetArgs {
    /// Exact Morpho market parameters.
    pub(crate) market: MarketParamsArgs,
    /// Desired final vault assets in this market. The final destination must use uint256 max.
    pub(crate) assets: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub(crate) struct SimulatePlanArgs {
    /// Stable identifier copied from a plan returned by plan_reallocation.
    pub(crate) plan_id: String,
    /// Manager or monitoring-system alert identifier.
    pub(crate) risk_signal_id: String,
    /// EVM chain id. This pilot accepts Ethereum mainnet only.
    pub(crate) chain_id: u64,
    /// MetaMorpho vault target.
    pub(crate) vault: String,
    /// Ordered target allocations reviewed by the manager.
    pub(crate) allocations: Vec<AllocationTargetArgs>,
    /// Morpho market ids whose residual exposure is bounded.
    pub(crate) risk_market_ids: Vec<String>,
    /// Maximum acceptable residual assets in USDC base units.
    pub(crate) max_residual_assets: String,
    /// True only after the manager has selected this plan for fork simulation.
    pub(crate) manager_selected: bool,
}

/// `serde_json::Value` derives an unconstrained (empty) schema, which model
/// providers reject: every tool-parameter schema node must carry a `type`.
/// The simulation result is host-injected opaque JSON, so declare it as an
/// open object rather than leaving the node untyped.
fn host_injected_object(_generator: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "object",
        "properties": {},
        "additionalProperties": true
    })
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct FinalizeSimulationArgs {
    /// Stable plan identifier.
    pub(crate) plan_id: String,
    /// Alert identifier.
    pub(crate) risk_signal_id: String,
    /// Ethereum chain id.
    pub(crate) chain_id: u64,
    /// MetaMorpho vault target.
    pub(crate) vault: String,
    /// Exact reviewed allocation tuples.
    pub(crate) allocations: Vec<AllocationTargetArgs>,
    /// Risk market ids the plan is intended to reduce.
    pub(crate) risk_market_ids: Vec<String>,
    /// Declared maximum residual exposure.
    pub(crate) max_residual_assets: String,
    /// Full host simulate_batch result injected by the routed runtime.
    #[schemars(schema_with = "host_injected_object")]
    pub(crate) simulation_result: Value,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub(crate) struct VerifyExecutionArgs {
    /// Ethereum transaction hash after the manager Safe executes the proposal.
    pub(crate) transaction_hash: String,
    /// MetaMorpho vault whose receipt and residual allocation must be verified.
    pub(crate) vault: String,
    /// Morpho market ids that should be at or below the residual threshold.
    pub(crate) risk_market_ids: Vec<String>,
    /// Maximum acceptable combined residual assets in vault-asset base units.
    pub(crate) max_residual_assets: String,
    /// Manager-provided alert or incident identifier.
    pub(crate) risk_signal_id: String,
}
