//! End-to-end against a running LiqSteward backend and a real Ethereum RPC.
//!
//! This harness plays the *host*: it performs every routed read with a plain
//! `eth_call` at the pinned block, stamps the result with keccak the way the
//! Aomi host does, and relays it into the plugin tools exactly as an agent
//! would. It therefore covers plugin verification and decoding, the backend's
//! own re-verification, node creation, pricing, compile, and export, all on
//! live chain bytes.
//!
//! Run with the backend up on `LIQSTEWARD_BFF_URL` (seeded with the pilot
//! policy) and a mainnet RPC that serves recent historical `eth_call`s:
//!
//! ```text
//! LIQSTEWARD_BFF_URL=http://127.0.0.1:4310 LIQSTEWARD_BFF_TOKEN=dev-token \
//! NAV_E2E_RPC=https://ethereum-rpc.publicnode.com \
//! cargo test -p nav-oracle --test e2e_pinned -- --ignored --nocapture
//! ```

use alloy_primitives::{Address, B256, U256, hex, keccak256};
use aomi_sdk::testing::{TestCtxBuilder, run_tool};
use aomi_sdk::{DynToolCallCtx, RouteStep, ToolReturn};
use nav_oracle::NavOracle;
use nav_oracle::tools::{CompileNav, ExpandNode, ExportNavReport, OpenValuation, PriceNodes, WriteToDag};
use serde_json::{Value, json};
use std::collections::VecDeque;

const VAULT: &str = "0x8eb67a509616cd6a7c1b3c8c21d48ff57df3d458";

struct Host {
    rpc: String,
    http: reqwest::blocking::Client,
}

impl Host {
    fn call(&self, method: &str, params: Value) -> Value {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let response: Value = self
            .http
            .post(&self.rpc)
            .json(&body)
            .send()
            .expect("rpc reachable")
            .json()
            .expect("rpc json");
        assert!(response.get("error").is_none(), "rpc error: {}", response["error"]);
        response["result"].clone()
    }

    /// Encode `signature(args)` the way the host's ABI encoder does for the
    /// argument types the adapters use: address, bytes32, uint256.
    fn calldata(signature: &str, arguments: &[String]) -> Vec<u8> {
        let selector = &keccak256(signature.as_bytes())[..4];
        let open = signature.find('(').unwrap();
        let types = signature[open + 1..signature.len() - 1]
            .split(',')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        assert_eq!(types.len(), arguments.len(), "arity for {signature}");
        let mut data = selector.to_vec();
        for (ty, arg) in types.iter().zip(arguments) {
            let word: [u8; 32] = match *ty {
                "address" => {
                    let address: Address = arg.parse().unwrap();
                    let mut word = [0u8; 32];
                    word[12..].copy_from_slice(address.as_slice());
                    word
                }
                "bytes32" => arg.parse::<B256>().unwrap().0,
                "uint256" => arg.parse::<U256>().unwrap().to_be_bytes(),
                other => panic!("harness cannot encode {other}"),
            };
            data.extend_from_slice(&word);
        }
        data
    }

    /// Perform one routed `encode_and_call` step at the pin and produce the
    /// relayed read an agent would copy from the host result.
    fn read(&self, step: &RouteStep, pin: u64) -> Value {
        assert_eq!(step.tool, "encode_and_call");
        assert_eq!(step.args["block_tag"], pin.to_string(), "every read is pinned");
        let signature = step.args["function_signature"].as_str().unwrap();
        let arguments = step.args["arguments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        let to = step.args["to"].as_str().unwrap();
        let data = Self::calldata(signature, &arguments);
        let result = self.call(
            "eth_call",
            json!([{ "to": to, "data": format!("0x{}", hex::encode(&data)) }, format!("0x{pin:x}")]),
        );
        let raw = result.as_str().unwrap().to_owned();
        let bytes = hex::decode(raw.trim_start_matches("0x")).unwrap();
        json!({
            "function_signature": signature,
            "arguments": arguments,
            "target": to,
            "served_block": pin,
            "result_keccak": format!("0x{}", hex::encode(keccak256(&bytes))),
            "raw_result": raw,
        })
    }
}

fn ctx(tool: &str) -> DynToolCallCtx {
    TestCtxBuilder::new(tool).session_id("e2e-session").build()
}

fn require(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("set {name} to run the e2e harness"))
}

#[test]
#[ignore = "needs a running backend and a mainnet RPC"]
fn values_the_pilot_vault_end_to_end_at_a_pinned_block() {
    require("LIQSTEWARD_BFF_URL");
    require("LIQSTEWARD_BFF_TOKEN");
    let host = Host {
        rpc: require("NAV_E2E_RPC"),
        http: reqwest::blocking::Client::new(),
    };
    let app = NavOracle;

    // Pin two blocks below the head, like open_valuation's default, but chosen
    // here so the harness and the backend agree on the number.
    let head = u64::from_str_radix(host.call("eth_blockNumber", json!([])).as_str().unwrap().trim_start_matches("0x"), 16).unwrap();
    let pin = head - 2;

    let opened = run_tool::<OpenValuation>(&app, json!({ "vault": VAULT, "chain_id": 1, "block": pin }), ctx("open_valuation")).unwrap();
    let dag_id = opened.value["dag_id"].as_str().unwrap().to_owned();
    assert_eq!(opened.value["pin"]["block_number"], pin);
    assert_eq!(opened.routes.len(), 1, "open routes the first expansion");
    eprintln!("dag {dag_id} pinned at {pin}");

    // Breadth-first over every routed expand_node until the frontier drains.
    let mut queue: VecDeque<Value> = opened.routes.iter().map(|step| step.args.clone()).collect();
    let mut writes = 0;
    let mut reads = 0;
    while let Some(expand_args) = queue.pop_front() {
        let expanded = run_tool::<ExpandNode>(&app, expand_args.clone(), ctx("expand_node")).unwrap();
        if expanded.routes.is_empty() {
            continue; // already handled (a child reached from two parents)
        }
        let stage = expanded.value["stage"].as_u64().unwrap() as u32;
        let relayed = expanded
            .routes
            .iter()
            .filter(|step| step.tool == "encode_and_call")
            .map(|step| host.read(step, pin))
            .collect::<Vec<_>>();
        reads += relayed.len();
        let write_step = expanded.routes.iter().find(|step| step.tool == "write_to_dag").expect("route ends in write_to_dag");
        let written: ToolReturn = run_tool::<WriteToDag>(
            &app,
            json!({
                "dag_id": write_step.args["dag_id"],
                "node_id": write_step.args["node_id"],
                "stage": stage,
                "reads": relayed,
            }),
            ctx("write_to_dag"),
        )
        .unwrap();
        writes += 1;
        let verdict = written.value["verdict"].as_str().unwrap();
        assert_ne!(verdict, "unresolved", "node went unresolved: {}", written.value);
        for step in &written.routes {
            assert_eq!(step.tool, "expand_node");
            queue.push_back(step.args.clone());
        }
    }
    eprintln!("{writes} node writes, {reads} pinned reads");
    assert!(writes >= 3, "vault root, at least one market, and the idle balance");

    let priced = run_tool::<PriceNodes>(&app, json!({ "dag_id": dag_id }), ctx("price_nodes")).unwrap();
    let unpriced = priced.value["unpriced"].as_array().unwrap();
    assert!(unpriced.is_empty(), "unpriced nodes: {unpriced:?}");

    let compiled = run_tool::<CompileNav>(&app, json!({ "dag_id": dag_id }), ctx("compile_nav")).unwrap();
    assert_eq!(compiled.value["compiled"], true, "compile refused: {}", compiled.value);
    let report = &compiled.value["report"];
    let nav: u128 = report["totals"]["nav_base"].as_str().unwrap().parse().unwrap();
    assert!(nav > 0);
    let checks = report["checks"].as_array().unwrap();
    let total_assets = checks.iter().find(|check| check["id"] == "vault_total_assets").expect("vault_total_assets check ran");
    eprintln!(
        "nav {} USDC, posted {} USDC, delta {} bps, verdict {}",
        nav / 1_000_000,
        total_assets["posted"].as_str().unwrap().parse::<u128>().unwrap() / 1_000_000,
        total_assets["delta_bps"],
        total_assets["verdict"]
    );
    // Shares-at-stored-totals undervalues the vault's accrued view by the
    // interest not yet written to storage; a few bps at most on a live vault.
    assert!(total_assets["delta_bps"].as_u64().unwrap() < 100, "{}", total_assets);
    assert!(checks.iter().filter(|check| check["scope"] == "per_node").all(|check| check["verdict"] == "pass"));

    let exported = run_tool::<ExportNavReport>(&app, json!({ "dag_id": dag_id }), ctx("export_nav_report")).unwrap();
    let json_url = exported.value["json_url"].as_str().unwrap();
    let bundle: Value = host.http.get(json_url).send().unwrap().json().unwrap();
    assert_eq!(bundle["schema"], "liqsteward/nav-export/v1");
    assert_eq!(bundle["report"]["dag_digest"], report["dag_digest"]);
    assert!(bundle["nodes"].as_array().unwrap().iter().all(|node| node["status"] != "unresolved"));
    let html = host.http.get(exported.value["html_url"].as_str().unwrap()).send().unwrap().text().unwrap();
    assert!(html.contains(&dag_id));

    // A retyped nibble must be refused, not stored: open a second dag and
    // corrupt the first relayed read.
    let again = run_tool::<OpenValuation>(&app, json!({ "vault": VAULT, "chain_id": 1, "block": pin }), ctx("open_valuation")).unwrap();
    let expanded = run_tool::<ExpandNode>(&app, again.routes[0].args.clone(), ctx("expand_node")).unwrap();
    let mut relayed = expanded.routes.iter().filter(|step| step.tool == "encode_and_call").map(|step| host.read(step, pin)).collect::<Vec<_>>();
    let raw = relayed[0]["raw_result"].as_str().unwrap().to_owned();
    let last = raw.chars().last().unwrap();
    relayed[0]["raw_result"] = Value::String(format!("{}{}", &raw[..raw.len() - 1], if last == '0' { '1' } else { '0' }));
    let write_step = expanded.routes.iter().find(|step| step.tool == "write_to_dag").unwrap();
    let refused = run_tool::<WriteToDag>(
        &app,
        json!({ "dag_id": write_step.args["dag_id"], "node_id": write_step.args["node_id"], "stage": 0, "reads": relayed }),
        ctx("write_to_dag"),
    )
    .unwrap();
    assert_eq!(refused.value["verdict"], "unresolved");
    assert_eq!(refused.value["reason"], "transport_digest_mismatch");
    assert_eq!(refused.value["node"]["unresolved"]["attempts"], 1);
}
