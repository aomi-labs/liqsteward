use crate::client::*;
use alloy_primitives::{Address, U256, hex};
use alloy_sol_types::{SolCall, sol};
use aomi_sdk::*;
use serde_json::{Value, json};
use std::str::FromStr;

sol! {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    struct MarketAllocation {
        MarketParams marketParams;
        uint256 assets;
    }

    function reallocate(MarketAllocation[] calldata allocations) external;
}

const EVM_STAGE_TX: &str = "evm_stage_tx";
const SIMULATE_BATCH: &str = "simulate_batch";
const EVM_COMMIT_TXS: &str = "evm_commit_txs";
const MAX_UINT256: &str =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const REALLOCATE_SELECTOR: &str = "0x7299aa31";
const ETHEREUM_RPC: &str = "https://ethereum-rpc.publicnode.com";
const MORPHO_GRAPHQL: &str = "https://api.morpho.org/graphql";

fn rpc(method: &str, params: Value) -> Result<Value, String> {
    let response = RiskOffClient::new()?.post(
        ETHEREUM_RPC,
        &json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }),
    )?;
    if let Some(error) = response.get("error") {
        return Err(format!("Ethereum RPC returned an error: {error}"));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

fn incident_replay() -> Value {
    json!({
        "status": "embedded_public_evidence",
        "incident": "usd0pp-2025-01",
        "vault": {
            "address": "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458",
            "name_at_replay": "Gauntlet USDC Balanced",
            "current_name": "Gauntlet USDC Core",
        },
        "window": {
            "from": "2025-01-09T20:00:00Z",
            "to": "2025-01-10T06:00:00Z",
        },
        "official_claim": {
            "text": "Nine transactions withdrew all exposure from USD0++ markets without bad debt.",
            "source": "https://vaultbook.gauntlet.xyz/resources/market-volatility",
            "provenance": "official_claim",
        },
        "chain_reconstruction": {
            "unique_reallocation_transactions": 9,
            "risk_in_transactions": 2,
            "pure_risk_off_transactions": 7,
            "supplied_to_risk_usd": 6438548.881816,
            "withdrawn_from_risk_usd": 31480165.563993,
            "provenance": "derived_from_public_morpho_events",
        },
        "reconciliation": {
            "status": "unresolved",
            "question": "Why does the public narrative describe all nine calls as withdrawals when the first two observed reallocations added USD0++ exposure?",
        },
        "representative_transaction": "0x895b26dd32f8c787ee51276aa802e0ff9c0e080e5e9aa3f6fbdc767c13446d2d",
    })
}

pub(crate) struct ReplayIncident;
impl DynAomiTool for ReplayIncident {
    type App = RiskOffApp;
    type Args = NoArgs;
    const NAME: &'static str = "replay_incident";
    const DESCRIPTION: &'static str = "Reconstruct the public USD0++ incident timeline, quantified exposure changes, and unresolved claim-to-chain discrepancy.";

    fn run(_app: &RiskOffApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        Ok(incident_replay())
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
        let transaction = rpc("eth_getTransactionByHash", json!([hash]))?;
        if transaction.is_null() {
            return Ok(json!({ "status": "not_found", "hash": hash, "chain_id": 1 }));
        }
        let receipt = rpc("eth_getTransactionReceipt", json!([hash]))?;
        let status = if receipt.is_null() {
            "pending"
        } else if receipt.get("status").and_then(Value::as_str) == Some("0x1") {
            "confirmed"
        } else {
            "reverted"
        };
        let input = transaction
            .get("input")
            .and_then(Value::as_str)
            .unwrap_or("0x");
        Ok(json!({
            "status": status,
            "hash": hash,
            "chain_id": 1,
            "from": transaction.get("from"),
            "to": transaction.get("to"),
            "block_number": transaction.get("blockNumber"),
            "input_selector": input.get(..10).unwrap_or(input),
            "receipt_status": receipt.get("status"),
            "receipt_logs": receipt.get("logs").and_then(Value::as_array).map(Vec::len),
            "source": ETHEREUM_RPC,
        }))
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
        RiskOffClient::new()?.get(&format!(
            "https://api.morpho.org/v0/vaults-v1/{}:{address}",
            args.chain_id
        ))
    }
}

pub(crate) struct PreviewContainment;
impl DynAomiTool for PreviewContainment {
    type App = RiskOffApp;
    type Args = NoArgs;
    const NAME: &'static str = "preview_containment";
    const DESCRIPTION: &'static str = "Read the historical USD0++ containment payload and policy explanation without staging or requesting a wallet. Use this before execute_containment, never as an execution substitute.";

    fn run(_app: &RiskOffApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let args = historical_preview_args();
        let calldata = encode_reallocate(&args)?;
        Ok(json!({
            "safety_notice": "Historical counterfactual only. For a live manager action, pass reviewed current allocations to execute_containment; that tool uses the evm-core stage/simulate/commit pipeline.",
            "policy": {
                "executable": false,
                "reason": "The incident is historical and the vault no longer carries the replayed state.",
                "required_authority": "authorized MetaMorpho allocator",
                "simulation": "required against current state before any wallet request",
            },
            "action": {
                "to": args.vault,
                "chain_id": args.chain_id,
                "data": calldata,
                "selector": REALLOCATE_SELECTOR,
                "allocations": args.allocations,
            },
        }))
    }
}

fn preview_allocation(
    collateral: &str,
    oracle: &str,
    lltv: &str,
    assets: &str,
) -> AllocationTargetArgs {
    AllocationTargetArgs {
        market: MarketParamsArgs {
            loan_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".to_owned(),
            collateral_token: collateral.to_owned(),
            oracle: oracle.to_owned(),
            irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC".to_owned(),
            lltv: lltv.to_owned(),
        },
        assets: assets.to_owned(),
    }
}

fn historical_preview_args() -> ExecuteContainmentArgs {
    ExecuteContainmentArgs {
        chain_id: 1,
        vault: "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458".to_owned(),
        allocations: vec![
            preview_allocation(
                "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
                "0x1325Eb089Ac14B437E78D5D481e32611F6907eF8",
                "860000000000000000",
                "0",
            ),
            preview_allocation(
                "0x5BaE9a5D67d1CA5b09B14c91935f635CFBF3b685",
                "0xE316c92D2B1f50a53E72461856fD50b2519e5800",
                "915000000000000000",
                "0",
            ),
            preview_allocation(
                "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
                "0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a",
                "860000000000000000",
                MAX_UINT256,
            ),
        ],
        risk_market_ids: vec![
            "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2".to_owned(),
            "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad".to_owned(),
        ],
        max_residual_assets: "0".to_owned(),
        incident_id: "usd0pp-2025-01-historical-preview".to_owned(),
        confirmed: false,
    }
}

fn evm_address(value: &str, field: &str) -> Result<(), String> {
    let body = value
        .strip_prefix("0x")
        .ok_or_else(|| format!("{field} must be 0x-prefixed"))?;
    if body.len() != 40 || !body.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("{field} must be a 20-byte EVM address"));
    }
    Ok(())
}

fn bytes32(value: &str, field: &str) -> Result<(), String> {
    let body = value
        .strip_prefix("0x")
        .ok_or_else(|| format!("{field} must be 0x-prefixed"))?;
    if body.len() != 64 || !body.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("{field} must be a 32-byte hex value"));
    }
    Ok(())
}

fn decimal(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("{field} must be a base-10 integer string"));
    }
    Ok(())
}

fn validate_execution(args: &ExecuteContainmentArgs) -> Result<(), String> {
    if !args.confirmed {
        return Err("confirmed must be true after the user reviews and approves the exact allocation targets".to_owned());
    }
    if args.chain_id != 1 {
        return Err("this pilot only supports Ethereum mainnet (chain_id 1)".to_owned());
    }
    evm_address(&args.vault, "vault")?;
    if args.allocations.len() < 2 {
        return Err(
            "allocations must include at least one zeroed risk market and one final destination"
                .to_owned(),
        );
    }
    if args.risk_market_ids.is_empty() {
        return Err("risk_market_ids must not be empty".to_owned());
    }
    for (index, market_id) in args.risk_market_ids.iter().enumerate() {
        bytes32(market_id, &format!("risk_market_ids[{index}]"))?;
    }
    decimal(&args.max_residual_assets, "max_residual_assets")?;

    let expected_loan = args.allocations[0].market.loan_token.to_lowercase();
    let last = args.allocations.len() - 1;
    for (index, allocation) in args.allocations.iter().enumerate() {
        evm_address(
            &allocation.market.loan_token,
            &format!("allocations[{index}].market.loan_token"),
        )?;
        evm_address(
            &allocation.market.collateral_token,
            &format!("allocations[{index}].market.collateral_token"),
        )?;
        evm_address(
            &allocation.market.oracle,
            &format!("allocations[{index}].market.oracle"),
        )?;
        evm_address(
            &allocation.market.irm,
            &format!("allocations[{index}].market.irm"),
        )?;
        decimal(
            &allocation.market.lltv,
            &format!("allocations[{index}].market.lltv"),
        )?;
        decimal(&allocation.assets, &format!("allocations[{index}].assets"))?;
        if allocation.market.loan_token.to_lowercase() != expected_loan {
            return Err("every allocation must use the same loan token".to_owned());
        }
        if index < last && allocation.assets != "0" {
            return Err(format!(
                "allocations[{index}].assets must be 0 for a risk-off leg"
            ));
        }
    }
    if args.allocations[last].assets != MAX_UINT256 {
        return Err("the final destination assets must be uint256 max so it receives all withdrawn liquidity".to_owned());
    }
    if args.incident_id.trim().is_empty() {
        return Err("incident_id must not be empty".to_owned());
    }
    Ok(())
}

fn encode_reallocate(args: &ExecuteContainmentArgs) -> Result<String, String> {
    let allocations = args
        .allocations
        .iter()
        .map(|allocation| {
            let market = &allocation.market;
            Ok(MarketAllocation {
                marketParams: MarketParams {
                    loanToken: Address::from_str(&market.loan_token)
                        .map_err(|error| format!("invalid loan token: {error}"))?,
                    collateralToken: Address::from_str(&market.collateral_token)
                        .map_err(|error| format!("invalid collateral token: {error}"))?,
                    oracle: Address::from_str(&market.oracle)
                        .map_err(|error| format!("invalid oracle: {error}"))?,
                    irm: Address::from_str(&market.irm)
                        .map_err(|error| format!("invalid irm: {error}"))?,
                    lltv: U256::from_str(&market.lltv)
                        .map_err(|error| format!("invalid lltv: {error}"))?,
                },
                assets: U256::from_str(&allocation.assets)
                    .map_err(|error| format!("invalid assets: {error}"))?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(format!(
        "0x{}",
        hex::encode(reallocateCall { allocations }.abi_encode())
    ))
}

fn execution_route(
    args: ExecuteContainmentArgs,
    wallet: String,
    calldata: String,
) -> Result<ToolReturn, String> {
    validate_execution(&args)?;
    if !calldata.starts_with(REALLOCATE_SELECTOR) {
        return Err(format!(
            "encoded calldata must begin with the MetaMorpho reallocate selector {REALLOCATE_SELECTOR}"
        ));
    }

    let stage_args = json!({
        "to": args.vault,
        "chain_id": args.chain_id,
        "description": format!(
            "Morpho vault risk-off containment for incident {}: zero {} risk markets and route remaining liquidity to the reviewed destination",
            args.incident_id,
            args.allocations.len() - 1,
        ),
        "data": { "raw": calldata },
        "value": "0",
        "kind": "vault_risk_off",
        "protocol": "morpho",
    });

    let verification_args = json!({
        "transaction_hash": null,
        "chain_id": args.chain_id,
        "vault": args.vault,
        "risk_market_ids": args.risk_market_ids,
        "max_residual_assets": args.max_residual_assets,
        "incident_id": args.incident_id,
    });
    let preview = json!({
        "status": "execution_route_armed",
        "operating_wallet": wallet,
        "authority": "connected wallet must hold the vault allocator role; Aomi does not own this authority",
        "chain_id": args.chain_id,
        "vault": args.vault,
        "allocation_count": args.allocations.len(),
        "risk_market_ids": args.risk_market_ids,
        "max_residual_assets": args.max_residual_assets,
        "pipeline": [EVM_STAGE_TX, SIMULATE_BATCH, EVM_COMMIT_TXS, VerifyExecution::NAME],
        "wallet_approval_required": true,
    });

    ToolReturn::route(preview)
        .next(|next| {
            next.add_named(EVM_STAGE_TX, stage_args)
                .note(
                    "Stage this exact MetaMorpho reallocate call. Preserve every tuple and target byte-for-byte. The host then simulates it; failed simulation stops before commit. A passing simulation proceeds to the host wallet approval request.",
                )
                .enforce(EnforcementPolicy::Stop, |enforce| {
                    enforce.add_named(SIMULATE_BATCH, json!({}));
                    enforce
                        .add_named(EVM_COMMIT_TXS, json!({}))
                        .bind_as("transaction_hash");
                });
        })
        .after::<VerifyExecution>(verification_args)
        .awaits("transaction_hash")
        .note("Transaction broadcast completed. Verify the canonical receipt and residual Morpho exposure now.")
        .try_build()
        .map_err(|error| format!("risk-off route build failed: {error}"))
}

pub(crate) struct ExecuteContainment;
impl DynAomiTool for ExecuteContainment {
    type App = RiskOffApp;
    type Args = ExecuteContainmentArgs;
    const NAME: &'static str = "execute_containment";
    const DESCRIPTION: &'static str = "Use only after the manager has reviewed and approved exact MetaMorpho target allocations. Routes the known reallocate call through the production evm-core pipeline: evm_stage_tx, mandatory simulate_batch with stop-on-failure, then evm_commit_txs for wallet approval. After broadcast, verify_execution checks the receipt and residual exposure. Never call host transaction tools separately.";

    fn run_with_routes(
        _app: &RiskOffApp,
        args: Self::Args,
        ctx: DynToolCallCtx,
    ) -> Result<ToolReturn, String> {
        let wallet = ctx
            .attribute_string(&["domain", "evm", "address"])
            .ok_or_else(|| {
                "connect the authorized EVM allocator wallet before executing containment"
                    .to_owned()
            })?;
        validate_execution(&args)?;
        let calldata = encode_reallocate(&args)?;
        execution_route(args, wallet, calldata)
    }
}

pub(crate) struct VerifyExecution;
impl DynAomiTool for VerifyExecution {
    type App = RiskOffApp;
    type Args = VerifyExecutionArgs;
    const NAME: &'static str = "verify_execution";
    const DESCRIPTION: &'static str = "Post-commit continuation. Verify the canonical receipt and compare current indexed Morpho allocations for the declared risk markets against the manager's residual threshold. Usually invoked automatically after execute_containment binds a transaction hash.";

    fn run(_app: &RiskOffApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let hash = args
            .transaction_hash
            .as_deref()
            .ok_or_else(|| "transaction_hash is required after wallet broadcast".to_owned())?;
        if !hash.starts_with("0x") || hash.len() != 66 {
            return Err("transaction_hash must be 0x-prefixed and 32 bytes".to_owned());
        }
        let receipt = rpc("eth_getTransactionReceipt", json!([hash]))?;
        if receipt.is_null() || receipt.get("status").and_then(Value::as_str) != Some("0x1") {
            return Ok(json!({
                "completion": "receipt_unverified",
                "incident_id": args.incident_id,
                "transaction_hash": hash,
                "receipt": receipt,
            }));
        }

        let query = r#"query VaultResidual($address: String!, $chainId: Int!) {
            vaultByAddress(address: $address, chainId: $chainId) {
                state { blockNumber allocation { supplyAssets market { marketId } } }
            }
        }"#;
        let response = RiskOffClient::new()?.post(
            MORPHO_GRAPHQL,
            &json!({ "query": query, "variables": { "address": args.vault, "chainId": args.chain_id } }),
        )?;
        if let Some(errors) = response.get("errors") {
            return Err(format!("Morpho GraphQL returned errors: {errors}"));
        }
        let state = response
            .pointer("/data/vaultByAddress/state")
            .ok_or_else(|| "Morpho returned no current vault state".to_owned())?;
        let risk_ids = args
            .risk_market_ids
            .iter()
            .map(|id| id.to_lowercase())
            .collect::<Vec<_>>();
        let mut residual = U256::ZERO;
        let mut matched = Vec::new();
        for allocation in state
            .get("allocation")
            .and_then(Value::as_array)
            .ok_or_else(|| "Morpho returned no allocation array".to_owned())?
        {
            let market_id = allocation
                .pointer("/market/marketId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if risk_ids.iter().any(|id| id == &market_id.to_lowercase()) {
                let supply = allocation
                    .get("supplyAssets")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Morpho allocation omitted supplyAssets".to_owned())?;
                let assets = U256::from_str(supply)
                    .map_err(|error| format!("invalid Morpho supplyAssets: {error}"))?;
                residual = residual
                    .checked_add(assets)
                    .ok_or_else(|| "residual exposure overflowed uint256".to_owned())?;
                matched.push(json!({ "market_id": market_id, "supply_assets": supply }));
            }
        }
        let threshold = U256::from_str(&args.max_residual_assets)
            .map_err(|error| format!("invalid residual threshold: {error}"))?;
        let threshold_passed = residual <= threshold;
        Ok(json!({
            "completion": if threshold_passed { "complete" } else { "residual_above_threshold" },
            "incident_id": args.incident_id,
            "transaction_hash": hash,
            "receipt_status": "confirmed",
            "indexed_block": state.get("blockNumber"),
            "residual_assets": residual.to_string(),
            "max_residual_assets": threshold.to_string(),
            "threshold_passed": threshold_passed,
            "risk_allocations": matched,
            "source": MORPHO_GRAPHQL,
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
        Ok(json!({
            "schema": "risk-off-evidence/v1",
            "generated_by": "risk-off-pilot-aomi-app",
            "evidence": incident_replay(),
            "limitations": [
                "Public indexer data is not a substitute for Gauntlet internal alert identity.",
                "Historical preview calldata must not be executed against current state.",
            ],
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allocation(collateral: &str, oracle: &str, assets: &str) -> AllocationTargetArgs {
        AllocationTargetArgs {
            market: MarketParamsArgs {
                loan_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".to_owned(),
                collateral_token: collateral.to_owned(),
                oracle: oracle.to_owned(),
                irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC".to_owned(),
                lltv: "860000000000000000".to_owned(),
            },
            assets: assets.to_owned(),
        }
    }

    fn valid_args() -> ExecuteContainmentArgs {
        ExecuteContainmentArgs {
            chain_id: 1,
            vault: "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458".to_owned(),
            allocations: vec![
                allocation(
                    "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
                    "0x1325Eb089Ac14B437E78D5D481e32611F6907eF8",
                    "0",
                ),
                allocation(
                    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
                    "0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a",
                    MAX_UINT256,
                ),
            ],
            risk_market_ids: vec![
                "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2".to_owned(),
            ],
            max_residual_assets: "0".to_owned(),
            incident_id: "usd0pp-test".to_owned(),
            confirmed: true,
        }
    }

    #[test]
    fn execution_route_uses_production_evm_namespace_pipeline() {
        let route = execution_route(
            valid_args(),
            "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045".to_owned(),
            format!("{REALLOCATE_SELECTOR}00"),
        )
        .unwrap();
        assert_eq!(route.routes[0].tool, EVM_STAGE_TX);
        let enforcement = route.routes[0].enforcement.as_ref().unwrap();
        assert_eq!(enforcement.on_failure, EnforcementPolicy::Stop);
        assert_eq!(enforcement.steps[0].tool, SIMULATE_BATCH);
        assert_eq!(enforcement.steps[1].tool, EVM_COMMIT_TXS);
        assert_eq!(
            enforcement.steps[1].bind_as.as_deref(),
            Some("transaction_hash")
        );
        assert_eq!(route.routes[1].tool, VerifyExecution::NAME);
    }

    #[test]
    fn route_stages_raw_viem_calldata_instead_of_returning_a_safe_batch() {
        let route = execution_route(
            valid_args(),
            "0x0000000000000000000000000000000000000001".to_owned(),
            format!("{REALLOCATE_SELECTOR}1234"),
        )
        .unwrap();
        let stage = &route.routes[0].args;
        assert_eq!(stage["data"]["raw"], "0x7299aa311234");
        assert_eq!(stage["chain_id"], 1);
        assert_eq!(stage["kind"], "vault_risk_off");
    }

    #[test]
    fn alloy_encoder_matches_the_known_metamorpho_selector() {
        let calldata = encode_reallocate(&valid_args()).unwrap();
        assert!(calldata.starts_with(REALLOCATE_SELECTOR));
        assert!(calldata.len() > 10);
    }

    #[test]
    fn risk_off_policy_rejects_nonzero_source_allocations() {
        let mut args = valid_args();
        args.allocations[0].assets = "1".to_owned();
        assert!(validate_execution(&args).unwrap_err().contains("must be 0"));
    }

    #[test]
    fn execution_requires_explicit_confirmation() {
        let mut args = valid_args();
        args.confirmed = false;
        assert!(
            validate_execution(&args)
                .unwrap_err()
                .contains("confirmed must be true")
        );
    }

    #[test]
    fn execution_rejects_unverified_chains() {
        let mut args = valid_args();
        args.chain_id = 8453;
        assert!(
            validate_execution(&args)
                .unwrap_err()
                .contains("only supports Ethereum mainnet")
        );
    }
}
