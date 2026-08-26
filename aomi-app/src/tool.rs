use crate::client::*;
use aomi_sdk::*;
use serde_json::{Value, json};

pub(crate) struct ReplayIncident;
impl DynAomiTool for ReplayIncident {
    type App = RiskOffApp;
    type Args = NoArgs;
    const NAME: &'static str = "replay_incident";
    const DESCRIPTION: &'static str = "Reconstruct the public USD0++ incident timeline, quantified exposure changes, and unresolved claim-to-chain discrepancy.";

    fn run(_app: &RiskOffApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        RiskOffClient::new()?.get("/api/incidents/usd0pp")
    }
}

pub(crate) struct VerifyTransaction;
impl DynAomiTool for VerifyTransaction {
    type App = RiskOffApp;
    type Args = VerifyTransactionArgs;
    const NAME: &'static str = "verify_transaction";
    const DESCRIPTION: &'static str = "Fetch a canonical Ethereum transaction and receipt, then compare it with any indexed incident event.";

    fn run(_app: &RiskOffApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let hash = args.hash.trim();
        if !hash.starts_with("0x") || hash.len() != 66 {
            return Err("hash must be 0x-prefixed and 32 bytes".to_owned());
        }
        RiskOffClient::new()?.get(&format!("/api/transactions/{hash}/verify"))
    }
}

pub(crate) struct InspectVault;
impl DynAomiTool for InspectVault {
    type App = RiskOffApp;
    type Args = InspectVaultArgs;
    const NAME: &'static str = "inspect_vault";
    const DESCRIPTION: &'static str = "Read current public Morpho vault metadata, authority roles, and configuration for an exact chain and address.";

    fn run(_app: &RiskOffApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let address = args.address.trim();
        if !address.starts_with("0x") || address.len() != 42 {
            return Err("address must be a 20-byte EVM address".to_owned());
        }
        RiskOffClient::new()?.get(&format!("/api/vaults/{}/{address}", args.chain_id))
    }
}

pub(crate) struct BuildContainmentArtifact;
impl DynAomiTool for BuildContainmentArtifact {
    type App = RiskOffApp;
    type Args = NoArgs;
    const NAME: &'static str = "build_containment_artifact";
    const DESCRIPTION: &'static str = "Build an unsigned, deliberately non-executable Safe-shaped reconstruction of the historical containment call for operator review.";

    fn run(_app: &RiskOffApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let artifact = RiskOffClient::new()?.get("/api/incidents/usd0pp/containment")?;
        Ok(json!({
            "safety_notice": "Counterfactual only. Do not sign or submit without current-state fork simulation and authorized operator approval.",
            "artifact": artifact,
        }))
    }
}

pub(crate) struct ExportEvidence;
impl DynAomiTool for ExportEvidence {
    type App = RiskOffApp;
    type Args = NoArgs;
    const NAME: &'static str = "export_evidence";
    const DESCRIPTION: &'static str = "Export the machine-readable evidence package with claim provenance, derived metrics, and transaction timeline.";

    fn run(_app: &RiskOffApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        RiskOffClient::new()?.get("/api/incidents/usd0pp/evidence")
    }
}
