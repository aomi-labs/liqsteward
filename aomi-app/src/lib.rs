use aomi_sdk::*;

mod client;
mod tool;

const PREAMBLE: &str = r#"## Role
You are LiqSteward, the control-room copilot for one authorized manager of the Ethereum Gauntlet USDC Core MetaMorpho vault.

## Safety boundary
- Separate official claims from chain-verified evidence and derived conclusions.
- Gauntlet or another vault manager owns the risk decision; the manager-controlled Safe owns approval and execution authority.
- Never claim Aomi is the curator, allocator, signer, or custodian.
- Never call `evm_commit_txs`, request a signature, or broadcast from this app.
- The only transaction route is `evm_stage_tx` -> `simulate_batch` -> `finalize_simulation`.
- A failed simulation stops the route. A passing simulation produces unsigned Safe Transaction Builder JSON for manager review.
- Use exact hashes and addresses in outputs; do not silently reconcile discrepancies.
- Treat policy fields marked `assumed_pending_gauntlet_confirmation` as pilot placeholders, not Gauntlet-approved operating policy.

## Workflow
1. Use `inspect_vault` to pin live roles, queues, caps, pending changes, allocations, rates, and liquidity.
2. Use `get_pilot_policy` to show deterministic constraints and unresolved assumptions.
3. Use `plan_reallocation` with a real risk signal to produce admissible and rejected alternatives.
4. After the manager selects exact allocations, use `simulate_plan`. It validates fresh state, stages exact calldata through `evm-core`, and enforces fork simulation.
5. `finalize_simulation` runs only after a passing host simulation and returns an unsigned Safe approval package. Do not submit it.
6. If the manager later executes independently, use `verify_execution` with the resulting hash.
7. Use `replay_incident` and `verify_transaction` for the historical USD0++ acceptance test.
"#;

dyn_aomi_app!(
    app = client::LiqStewardApp,
    name = "liqsteward",
    version = "0.2.0",
    preamble = PREAMBLE,
    tools = [
        client::ReplayIncident,
        client::VerifyTransaction,
        client::InspectVault,
        client::GetPilotPolicy,
        client::PlanReallocation,
        client::SimulatePlan,
        client::FinalizeSimulation,
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
        let manifest = client::LiqStewardApp.manifest();
        let tools = manifest
            .tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(manifest.namespaces, Some(vec!["evm-core".to_owned()]));
        assert!(tools.contains(&"simulate_plan"));
        assert!(tools.contains(&"finalize_simulation"));
        assert!(tools.contains(&"verify_execution"));
        assert!(!tools.contains(&"execute_containment"));
        assert!(!tools.contains(&"evm_commit_txs"));
    }

    #[test]
    fn every_provider_object_schema_has_properties() {
        let manifest = serde_json::to_value(client::LiqStewardApp.manifest()).unwrap();
        assert_strict_object_schemas(&manifest, "manifest");
    }

    /// Model providers reject any tool-parameter property whose schema lacks a
    /// `type` key (an untyped node is what `serde_json::Value` derives by
    /// default). The whole app fails to load when one tool is rejected, so
    /// pin every declared parameter property to a typed schema.
    #[test]
    fn every_tool_parameter_property_is_typed() {
        let manifest = serde_json::to_value(client::LiqStewardApp.manifest()).unwrap();
        let tools = manifest["tools"].as_array().expect("manifest tools");
        for tool in tools {
            let name = tool["name"].as_str().unwrap_or("?");
            let Some(properties) = tool
                .get("parameters")
                .and_then(|parameters| parameters.get("properties"))
                .and_then(serde_json::Value::as_object)
            else {
                continue;
            };
            for (property, schema) in properties {
                assert!(
                    schema.get("type").is_some()
                        || schema.get("$ref").is_some()
                        || schema.get("anyOf").is_some()
                        || schema.get("oneOf").is_some(),
                    "tool `{name}` property `{property}` has no type: {schema}"
                );
            }
        }
    }
}
