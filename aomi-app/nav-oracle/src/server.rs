//! Typed calls to the LiqSteward backend's `/api/nav/*` surface.

use crate::model::{Dag, ExpectedRead, Node, NodeWrite};
use aomi_sdk::DynToolCallCtx;
use liqsteward_core::bff::{BffClient, BffError};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

pub struct NavServer {
    client: BffClient,
}

fn describe(error: BffError) -> String {
    error.to_string()
}

fn parse<T: DeserializeOwned>(value: Value, what: &str) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| format!("backend returned an unexpected {what}: {error}"))
}

impl NavServer {
    pub fn from_ctx(ctx: &DynToolCallCtx) -> Result<Self, String> {
        BffClient::from_ctx(ctx).map(|client| Self { client }).map_err(describe)
    }

    pub fn base_url(&self) -> &str {
        self.client.base_url()
    }

    pub fn open_dag(&self, body: &Value) -> Result<(Dag, Vec<Node>), String> {
        let response = self.client.post("/api/nav/dags", body).map_err(describe)?;
        let dag = parse::<Dag>(response["dag"].clone(), "dag")?;
        let roots = parse::<Vec<Node>>(response["roots"].clone(), "root node list")?;
        Ok((dag, roots))
    }

    pub fn dag(&self, dag_id: &str) -> Result<(Dag, Vec<Node>), String> {
        let response = self.client.get(&format!("/api/nav/dags/{dag_id}")).map_err(describe)?;
        let dag = parse::<Dag>(response["dag"].clone(), "dag")?;
        let nodes = parse::<Vec<Node>>(response["nodes"].clone(), "node list")?;
        Ok((dag, nodes))
    }

    pub fn node(&self, dag_id: &str, node_id: &str) -> Result<Node, String> {
        let response = self.client.get(&format!("/api/nav/dags/{dag_id}/nodes/{node_id}")).map_err(describe)?;
        parse(response, "node")
    }

    pub fn plan(&self, dag_id: &str, node_id: &str, stage: u32, reads: &[ExpectedRead]) -> Result<Node, String> {
        let response = self
            .client
            .post(&format!("/api/nav/dags/{dag_id}/nodes/{node_id}/plan"), &json!({ "stage": stage, "expected_reads": reads }))
            .map_err(describe)?;
        parse(response, "node")
    }

    /// Returns the written node and the children the server created.
    pub fn write(&self, dag_id: &str, body: &NodeWrite) -> Result<(Node, Vec<Node>), String> {
        let response = self.client.post(&format!("/api/nav/dags/{dag_id}/nodes"), body).map_err(describe)?;
        let node = parse::<Node>(response["node"].clone(), "node")?;
        let children = parse::<Vec<Node>>(response["children"].clone(), "children")?;
        Ok((node, children))
    }

    pub fn policy(&self, vault: &str, policy_id: Option<&str>, version: Option<u32>) -> Result<Value, String> {
        let mut path = format!("/api/nav/policies/{vault}");
        let mut query = Vec::new();
        if let Some(id) = policy_id {
            query.push(format!("policy_id={id}"));
        }
        if let Some(version) = version {
            query.push(format!("version={version}"));
        }
        if !query.is_empty() {
            path.push('?');
            path.push_str(&query.join("&"));
        }
        self.client.get(&path).map_err(describe)
    }

    pub fn price(&self, dag_id: &str, node_ids: Option<&[String]>) -> Result<Value, String> {
        let body = match node_ids {
            Some(ids) => json!({ "node_ids": ids }),
            None => json!({}),
        };
        self.client.post(&format!("/api/nav/dags/{dag_id}/price"), &body).map_err(describe)
    }

    /// `Ok(Err(refusal))` when the server refused with 409; the refusal is a
    /// tool result, not a tool error, so the agent can act on it.
    pub fn compile(&self, dag_id: &str) -> Result<Result<Value, Value>, String> {
        match self.client.post(&format!("/api/nav/dags/{dag_id}/compile"), &json!({})) {
            Ok(value) => Ok(Ok(value)),
            Err(BffError::Status { status: 409, body }) => {
                Ok(Err(serde_json::from_str(&body).unwrap_or_else(|_| json!({ "refused": body }))))
            }
            Err(error) => Err(describe(error)),
        }
    }
}
