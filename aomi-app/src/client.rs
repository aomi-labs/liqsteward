use aomi_sdk::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use std::{env, time::Duration};

#[derive(Clone, Default)]
pub(crate) struct RiskOffApp;

pub(crate) use crate::tool::*;

#[derive(Clone)]
pub(crate) struct RiskOffClient {
    base_url: String,
    http: reqwest::blocking::Client,
}

impl RiskOffClient {
    pub(crate) fn new() -> Result<Self, String> {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| format!("failed to build HTTP client: {error}"))?;
        Ok(Self {
            base_url: env::var("RISK_OFF_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:4310".to_owned()),
            http,
        })
    }

    pub(crate) fn get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .http
            .get(format!("{}{}", self.base_url, path))
            .send()
            .map_err(|error| format!("risk-off API request failed: {error}"))?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(format!("risk-off API returned {status}: {body}"));
        }
        serde_json::from_str(&body).map_err(|error| format!("risk-off API decode failed: {error}"))
    }
}

#[derive(Debug, Default, Deserialize, JsonSchema)]
pub(crate) struct NoArgs {}

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
