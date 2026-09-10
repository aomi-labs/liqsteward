//! Client for the LiqSteward backend (`apps/api`).
//!
//! Every app in this workspace talks to the same backend with the same two
//! application-level secrets. The backend authenticates the service token
//! and scopes every write to the Aomi session that made the tool call, so
//! the session id travels on every request as a header.

use aomi_sdk::{DynToolCallCtx, Secret};
use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::time::Duration;

pub const BFF_URL: Secret = Secret::new(
    "LIQSTEWARD_BFF_URL",
    "Base URL of the LiqSteward backend, e.g. https://liqsteward.app",
    true,
);

pub const BFF_TOKEN: Secret = Secret::new(
    "LIQSTEWARD_BFF_TOKEN",
    "Service token the backend issues for Aomi apps (bearer auth on /api/nav/*)",
    true,
);

pub const SESSION_HEADER: &str = "x-aomi-session";
pub const CALL_HEADER: &str = "x-aomi-call";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BffError {
    MissingSecret(&'static str),
    Transport(String),
    Status { status: u16, body: String },
    Decode(String),
}

impl fmt::Display for BffError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSecret(name) => write!(f, "app secret `{name}` is not configured"),
            Self::Transport(detail) => write!(f, "LiqSteward backend unreachable: {detail}"),
            Self::Status { status, body } => {
                write!(f, "LiqSteward backend returned {status}: {body}")
            }
            Self::Decode(detail) => write!(f, "LiqSteward backend response is not JSON: {detail}"),
        }
    }
}

impl std::error::Error for BffError {}

/// The host fills `ctx.secrets` from the application vault. A local
/// `aomi-cli` run has no vault, so the same slot name is honoured as a plain
/// environment variable, which is the SDK's own fallback order.
fn secret(ctx: &DynToolCallCtx, name: &'static str) -> Result<String, BffError> {
    ctx.secrets
        .get(name)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var(name).ok().filter(|value| !value.trim().is_empty()))
        .ok_or(BffError::MissingSecret(name))
}

#[derive(Clone)]
pub struct BffClient {
    base_url: String,
    token: String,
    session_id: String,
    call_id: String,
    http: reqwest::blocking::Client,
}

impl BffClient {
    /// Build a client for one tool call from the secrets and identity the
    /// host attached to it.
    pub fn from_ctx(ctx: &DynToolCallCtx) -> Result<Self, BffError> {
        let base_url = secret(ctx, BFF_URL.name)?.trim_end_matches('/').to_owned();
        let token = secret(ctx, BFF_TOKEN.name)?;
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| BffError::Transport(error.to_string()))?;
        Ok(Self {
            base_url,
            token,
            session_id: ctx.session_id.clone(),
            call_id: ctx.call_id.clone(),
            http,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    fn send(&self, request: reqwest::blocking::RequestBuilder) -> Result<Value, BffError> {
        let response = request
            .bearer_auth(&self.token)
            .header(SESSION_HEADER, &self.session_id)
            .header(CALL_HEADER, &self.call_id)
            .send()
            .map_err(|error| BffError::Transport(error.to_string()))?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            return Err(BffError::Status {
                status: status.as_u16(),
                body,
            });
        }
        if body.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&body).map_err(|error| BffError::Decode(error.to_string()))
    }

    pub fn get(&self, path: &str) -> Result<Value, BffError> {
        self.send(self.http.get(self.url(path)))
    }

    pub fn post<T: Serialize + ?Sized>(&self, path: &str, body: &T) -> Result<Value, BffError> {
        self.send(self.http.post(self.url(path)).json(body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aomi_sdk::testing::TestCtxBuilder;

    #[test]
    fn missing_secrets_fail_closed_by_name() {
        let ctx = TestCtxBuilder::new("open_valuation").build();
        assert_eq!(
            BffClient::from_ctx(&ctx).err(),
            Some(BffError::MissingSecret("LIQSTEWARD_BFF_URL"))
        );
        let ctx = TestCtxBuilder::new("open_valuation")
            .secret(BFF_URL.name, "https://liqsteward.app/")
            .build();
        assert_eq!(
            BffClient::from_ctx(&ctx).err(),
            Some(BffError::MissingSecret("LIQSTEWARD_BFF_TOKEN"))
        );
    }

    #[test]
    fn client_carries_the_session_and_normalises_the_base_url() {
        let ctx = TestCtxBuilder::new("open_valuation")
            .session_id("sess-1")
            .secret(BFF_URL.name, "https://liqsteward.app/")
            .secret(BFF_TOKEN.name, "tok")
            .build();
        let client = BffClient::from_ctx(&ctx).unwrap();
        assert_eq!(client.base_url(), "https://liqsteward.app");
        assert_eq!(client.session_id(), "sess-1");
        assert_eq!(client.url("/api/nav/dags"), "https://liqsteward.app/api/nav/dags");
    }
}
