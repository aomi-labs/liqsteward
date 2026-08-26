use aomi_sdk::*;

mod client;
mod tool;

const PREAMBLE: &str = r#"## Role
You are the policy-bound execution and assurance copilot for an authorized vault manager.

## Safety boundary
- Separate official claims from chain-verified evidence and derived conclusions.
- Gauntlet or another vault manager owns the risk decision; the connected authorized allocator wallet owns execution authority.
- Never claim Aomi is the curator, allocator, signer, or custodian.
- Never claim a transaction was signed or submitted until the host returns a transaction hash.
- All writes must use the host `evm-core` pipeline: `evm_stage_tx` -> `simulate_batch` -> `evm_commit_txs`.
- A failed simulation stops the route. `evm_commit_txs` still requires wallet approval under host signing policy.
- Use exact hashes and addresses in outputs; do not silently reconcile discrepancies.

## Workflow
1. Use `replay_incident` to inspect the reconstructed USD0++ incident.
2. Use `verify_transaction` for canonical receipt and indexed-event checks.
3. Use `inspect_vault` for current public role and configuration data.
4. Use `preview_containment` for the historical, non-executable payload explainer.
5. Use `execute_containment` only after the user has approved exact allocations. It stages the known MetaMorpho call through `evm-core`; the route then simulates and, only if simulation passes, requests wallet approval.
6. `verify_execution` runs automatically after a transaction hash is bound. It verifies the receipt and checks indexed residual exposure against the declared threshold.
7. Use `export_evidence` to produce the evidence package for handoff or audit.
"#;

dyn_aomi_app!(
    app = client::RiskOffApp,
    name = "risk-off-pilot",
    version = "0.1.0",
    preamble = PREAMBLE,
    tools = [
        client::ReplayIncident,
        client::VerifyTransaction,
        client::InspectVault,
        client::PreviewContainment,
        client::ExecuteContainment,
        client::VerifyExecution,
        client::ExportEvidence,
    ],
    namespaces = ["evm-core"]
);

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_strict_object_schemas(value: &serde_json::Value, path: &str) {
        match value {
            serde_json::Value::Object(object) => {
                if object.get("type").and_then(serde_json::Value::as_str) == Some("object") {
                    assert!(
                        object
                            .get("properties")
                            .is_some_and(serde_json::Value::is_object),
                        "object schema at {path} must contain object-valued properties: {value}"
                    );
                }
                for (key, child) in object {
                    assert_strict_object_schemas(child, &format!("{path}/{key}"));
                }
            }
            serde_json::Value::Array(array) => {
                for (index, child) in array.iter().enumerate() {
                    assert_strict_object_schemas(child, &format!("{path}/{index}"));
                }
            }
            _ => {}
        }
    }

    #[test]
    fn manifest_exposes_operator_tools_and_evm_core() {
        let manifest = client::RiskOffApp.manifest();
        let tools = manifest
            .tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(manifest.namespaces, Some(vec!["evm-core".to_owned()]));
        assert!(tools.contains(&"execute_containment"));
        assert!(tools.contains(&"verify_execution"));
        assert!(!tools.contains(&"build_containment_artifact"));
    }

    #[test]
    fn every_provider_object_schema_has_properties() {
        let manifest = serde_json::to_value(client::RiskOffApp.manifest()).unwrap();
        assert_strict_object_schemas(&manifest, "manifest");
    }
}
