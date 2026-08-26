use aomi_sdk::schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Default)]
pub(crate) struct RiskOffApp;

pub(crate) use crate::tool::*;

#[derive(Clone)]
pub(crate) struct RiskOffClient {
    http: reqwest::blocking::Client,
}

impl RiskOffClient {
    pub(crate) fn new() -> Result<Self, String> {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
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
            .map_err(|error| format!("risk-off API request failed: {error}"))
    }

    fn decode(&self, response: reqwest::blocking::Response) -> Result<Value, String> {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(format!("risk-off API returned {status}: {body}"));
        }
        serde_json::from_str(&body).map_err(|error| format!("risk-off API decode failed: {error}"))
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
pub(crate) struct InspectVaultArgs {
    /// EVM chain id. The pilot currently supports public Morpho V1 REST data.
    pub(crate) chain_id: u64,
    /// Vault contract address.
    pub(crate) address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub(crate) struct MarketParamsArgs {
    /// Vault loan asset address. Every allocation in one MetaMorpho reallocation must use the same loan token.
    pub(crate) loan_token: String,
    /// Market collateral token address.
    pub(crate) collateral_token: String,
    /// Morpho market oracle address.
    pub(crate) oracle: String,
    /// Morpho interest-rate-model address.
    pub(crate) irm: String,
    /// Liquidation LTV as a base-10 1e18-scaled integer string.
    pub(crate) lltv: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub(crate) struct AllocationTargetArgs {
    /// Exact Morpho market parameters.
    pub(crate) market: MarketParamsArgs,
    /// Desired final vault assets in this market. Risk markets must be `0`; the final destination must be uint256 max to receive all remaining liquidity.
    pub(crate) assets: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub(crate) struct ExecuteContainmentArgs {
    /// EVM chain id for the connected allocator wallet and vault.
    pub(crate) chain_id: u64,
    /// MetaMorpho vault contract that the connected wallet is authorized to allocate.
    pub(crate) vault: String,
    /// Ordered target allocations. Risk markets first at zero; final safe destination at uint256 max.
    pub(crate) allocations: Vec<AllocationTargetArgs>,
    /// Morpho market ids expected to be reduced. Used for post-execution residual verification.
    pub(crate) risk_market_ids: Vec<String>,
    /// Maximum acceptable combined residual assets across risk markets, in vault-asset base units.
    pub(crate) max_residual_assets: String,
    /// Human/audit identifier for the manager's alert or incident.
    pub(crate) incident_id: String,
    /// Must be true only after the user has reviewed the exact allocation targets and asked to proceed.
    pub(crate) confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub(crate) struct VerifyExecutionArgs {
    /// Transaction hash injected by the host after wallet approval and broadcast.
    #[serde(default)]
    pub(crate) transaction_hash: Option<String>,
    /// Chain where the vault transaction executed.
    pub(crate) chain_id: u64,
    /// MetaMorpho vault whose receipt and residual allocation must be verified.
    pub(crate) vault: String,
    /// Morpho market ids that should be at or below the residual threshold.
    pub(crate) risk_market_ids: Vec<String>,
    /// Maximum acceptable combined residual assets in vault-asset base units.
    pub(crate) max_residual_assets: String,
    /// Manager-provided alert or incident identifier.
    pub(crate) incident_id: String,
}
