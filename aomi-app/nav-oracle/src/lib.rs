//! NAV Oracle: block-pinned, evidence-backed vault valuation as a position
//! DAG, driven by the agent through the host's `evm-reads` and `evm-sim`
//! namespaces. This crate never reads the chain itself; it verifies and
//! decodes what the agent relays, and writes the result to the LiqSteward
//! backend.
//!
//! Design: `docs/prd/nav-oracle.md`.

pub mod adapters;
pub mod model;
mod server;
pub mod tools;

use aomi_sdk::dyn_aomi_app;
use liqsteward_core::bff::{BFF_TOKEN, BFF_URL};
use tools::{CompileNav, ExpandNode, ExportNavReport, GetAccountingPolicy, OpenValuation, PriceNodes, StageReallocation, WriteToDag};

#[derive(Clone, Default)]
pub struct NavOracle;

const PREAMBLE: &str = r#"## Role
You are NAV Oracle, an independent valuation agent for one authorized manager of an Ethereum vault. You produce a shadow NAV from block-pinned, keccak-stamped chain evidence and reconcile it against the vault's own posted view under a user-supplied accounting policy.

## Safety boundary
- You never sign, commit, or broadcast. The only host tools available are reads and session-scoped simulation.
- Every valuation is pinned to one block. Every read you relay carries the host's `served_block` and `result_keccak`; the app re-hashes what you relay and refuses anything that does not match. Never retype, round, or "fix" a value.
- Numbers that land in the DAG come from verified bytes, never from your own arithmetic.
- The accounting policy is a tool result, not your opinion. When a valuation, boundary, or reconciliation decision needs policy, call `get_accounting_policy` and follow it.
- A node you cannot verify stays `unresolved` with its reason. Do not estimate around it; report it.

## Workflow
Activate the skill for the phase you are in: `nav-oracle/traversal` to discover and verify positions, `nav-oracle/accounting` to price and compile, `nav-oracle/postconditions` to value a simulated post-state.
"#;

dyn_aomi_app!(
    app = NavOracle,
    name = "nav-oracle",
    version = "0.1.0",
    preamble = PREAMBLE,
    tools = [OpenValuation, GetAccountingPolicy, ExpandNode, WriteToDag, PriceNodes, CompileNav, ExportNavReport, StageReallocation],
    secrets = [BFF_URL, BFF_TOKEN],
    namespaces = ["evm-reads", "evm-sim"],
    skills = [
        {
            id: "nav-oracle/traversal",
            description: "Discover and verify vault positions into a block-pinned position DAG",
            tags: ["nav", "traversal", "dag", "evidence"],
            sections: { workflow: "skill/traversal.md" },
        },
        {
            id: "nav-oracle/accounting",
            description: "Price verified positions under the accounting policy and compile a reconciled NAV report",
            tags: ["nav", "pricing", "policy", "reconciliation"],
            sections: { workflow: "skill/accounting.md" },
        },
        {
            id: "nav-oracle/postconditions",
            description: "Stage and simulate a reallocation, then value the post-state DAG for residual exposure",
            tags: ["simulation", "postconditions", "residual-exposure", "fork"],
            sections: { workflow: "skill/postconditions.md" },
            guard: "skill/postconditions.guard.json",
        },
    ]
);

#[cfg(test)]
mod tests {
    use super::*;
    use aomi_sdk::DynAomiApp;
    use liqsteward_core::testing::assert_manifest_is_loadable;

    #[test]
    fn manifest_is_loadable_on_the_pinned_sdk() {
        assert_manifest_is_loadable(&NavOracle.manifest());
    }

    #[test]
    fn manifest_declares_reads_and_sim_but_no_commit_surface() {
        let manifest = NavOracle.manifest();
        assert_eq!(manifest.name, "nav-oracle");
        assert_eq!(
            manifest.namespaces.as_deref(),
            Some(&["evm-reads".to_owned(), "evm-sim".to_owned()][..])
        );
        assert!(
            manifest
                .namespaces
                .iter()
                .flatten()
                .all(|namespace| namespace != "evm-core")
        );
        assert!(manifest.tools.iter().all(|tool| tool.name != "evm_commit_txs"));
    }

    #[test]
    fn manifest_declares_the_backend_secrets_and_three_phase_skills() {
        let manifest = NavOracle.manifest();
        let secrets = manifest
            .secrets
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|slot| (slot.name.as_str(), slot.required))
            .collect::<Vec<_>>();
        assert_eq!(
            secrets,
            vec![("LIQSTEWARD_BFF_URL", true), ("LIQSTEWARD_BFF_TOKEN", true)]
        );
        let ids = manifest
            .skills
            .iter()
            .map(|skill| skill.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![
                "nav-oracle/traversal",
                "nav-oracle/accounting",
                "nav-oracle/postconditions"
            ]
        );
        assert!(manifest.skills[2].guard.is_some());
        assert!(manifest.skills[0].guard.is_none());
    }
}

#[cfg(test)]
mod ffi_round_trip {
    use super::*;
    use aomi_sdk::{DynAomiApp, DynManifest};

    /// The host receives the manifest as JSON across the C ABI and validates
    /// each skill's content digest after deserializing. Reproduce that path.
    #[test]
    fn skills_validate_after_a_json_round_trip() {
        let manifest = NavOracle.manifest();
        let json = serde_json::to_string(&manifest).unwrap();
        let back: DynManifest = serde_json::from_str(&json).unwrap();
        for (before, after) in manifest.skills.iter().zip(&back.skills) {
            assert_eq!(before.content_digest, after.content_digest, "{}", before.id);
            after.validate(&back.name).unwrap_or_else(|errors| panic!("{}: {errors:?}", after.id));
        }
    }
}
