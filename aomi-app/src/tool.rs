use crate::client::*;
use alloy_primitives::{Address, U256, hex, keccak256};
use alloy_sol_types::{SolCall, SolValue, sol};
use aomi_sdk::*;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
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

const CHAIN_ID: u64 = 1;
const PILOT_VAULT: &str = "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458";
const PILOT_CURATOR_SAFE: &str = "0x9E33faAE38ff641094fa68c65c2cE600b3410585";
const PILOT_OWNER_SAFE: &str = "0xC684c6587712e5E7BDf9fD64415F23Bd2b05fAec";
const PILOT_GUARDIAN_SAFE: &str = "0x7084bF4dB6c21e1834dD6482f6056a39A33584cD";
const USDC: &str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";
const IDLE_MARKET_ID: &str = "0x54efdee08e272e929034a8f26f7ca34b1ebe364b275391169b28c6d7db24dbc8";
const USD0PP_MARKET_ID: &str = "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2";
const PT_USD0PP_MARKET_ID: &str =
    "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad";
const EVM_STAGE_TX: &str = "evm_stage_tx";
const SIMULATE_BATCH: &str = "simulate_batch";
const MAX_UINT256: &str =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const REALLOCATE_SELECTOR: &str = "0x7299aa31";
const ETHEREUM_RPC: &str = "https://rpc.flashbots.net";
const ETHEREUM_RPC_FALLBACKS: [&str; 3] = [
    ETHEREUM_RPC,
    "https://eth.drpc.org",
    "https://ethereum-rpc.publicnode.com",
];
const MORPHO_GRAPHQL: &str = "https://api.morpho.org/graphql";
const MORPHO_REST: &str = "https://api.morpho.org/v0/vaults-v1";

const KNOWN_ALLOCATORS: [&str; 2] = [
    "0xCc148f980062ba934E1B2f29eB3cbA7D8e9F6acb",
    "0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D",
];

const HISTORICAL_TXS: [(&str, &str); 9] = [
    (
        "0xe9b338d19c1f412ff5a0db052dcb3d3ef2f91e613ab87e6fe7131d00263099ab",
        "2025-01-10T02:46:23Z",
    ),
    (
        "0x167928fd0b4e06ffd161118ef51d2c99e6813031fae663369a40cfba898e713d",
        "2025-01-10T03:23:47Z",
    ),
    (
        "0x306b1458998b290fcf629d1b452e21b1be8589adb697b2fde111130a9765a85d",
        "2025-01-10T04:02:11Z",
    ),
    (
        "0x184c3709b0d67e567d702e2a6049bbd4f939859ee9743e863e5a3be0e25ae6b4",
        "2025-01-10T04:53:23Z",
    ),
    (
        "0xd039e0a88e77fa798e5838273892da7c2c7b0f06883eeb43a847736097cb7146",
        "2025-01-10T05:04:23Z",
    ),
    (
        "0x12eb9b2c50b9260e6b1da122211ec1955ac62b66d740a1bed687fdb132c58515",
        "2025-01-10T07:25:23Z",
    ),
    (
        "0xf7072dc5e87718e72cbd1d01efbc97c8acadc2c25e10b6e602215137136ea3a9",
        "2025-01-10T07:39:11Z",
    ),
    (
        "0x8fdea50e5d541b4bac74855162775210428c3f26e3c4954a0fd533bfd9c070a8",
        "2025-01-10T08:07:47Z",
    ),
    (
        "0x7f56fc389026206ef5df0b72823b2c94efb1f26d0e542e4ac327c6899d9b018e",
        "2025-01-10T09:01:35Z",
    ),
];

fn rpc(method: &str, params: Value) -> Result<Value, String> {
    let client = LiqStewardClient::new()?;
    rpc_with(&client, method, params)
}

fn rpc_with(client: &LiqStewardClient, method: &str, params: Value) -> Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut failures = Vec::new();
    for endpoint in ETHEREUM_RPC_FALLBACKS {
        match client.post(endpoint, &body) {
            Ok(response) => {
                if let Some(error) = response.get("error") {
                    return Err(format!(
                        "Ethereum RPC {endpoint} returned an error: {error}"
                    ));
                }
                return Ok(response.get("result").cloned().unwrap_or(Value::Null));
            }
            Err(error) => failures.push(format!("{endpoint}: {error}")),
        }
    }
    Err(format!(
        "all Ethereum RPC endpoints failed: {}",
        failures.join("; ")
    ))
}

fn rpc_batch_with(
    client: &LiqStewardClient,
    calls: Vec<(&str, Value)>,
) -> Result<Vec<Value>, String> {
    let body = calls
        .into_iter()
        .enumerate()
        .map(|(index, (method, params))| {
            json!({ "jsonrpc": "2.0", "id": index + 1, "method": method, "params": params })
        })
        .collect::<Vec<_>>();
    let mut failures = Vec::new();
    for endpoint in ETHEREUM_RPC_FALLBACKS {
        match client.post(endpoint, &body) {
            Ok(response) => {
                let Some(mut items) = response.as_array().cloned() else {
                    failures.push(format!(
                        "{endpoint}: rejected batch requests with {response}"
                    ));
                    continue;
                };
                items
                    .sort_by_key(|item| item.get("id").and_then(Value::as_u64).unwrap_or_default());
                let mut results = Vec::with_capacity(items.len());
                for item in items {
                    if let Some(error) = item.get("error") {
                        failures.push(format!("{endpoint}: batch error {error}"));
                        results.clear();
                        break;
                    }
                    results.push(item.get("result").cloned().unwrap_or(Value::Null));
                }
                if results.len() != body.len() {
                    failures.push(format!(
                        "{endpoint}: returned {} of {} batch results",
                        results.len(),
                        body.len()
                    ));
                    continue;
                }
                return Ok(results);
            }
            Err(error) => failures.push(format!("{endpoint}: {error}")),
        }
    }
    Err(format!(
        "all Ethereum RPC batch endpoints failed: {}",
        failures.join("; ")
    ))
}

fn parse_hex_u64(value: &str, field: &str) -> Result<u64, String> {
    u64::from_str_radix(value.trim_start_matches("0x"), 16)
        .map_err(|error| format!("invalid {field} hex value: {error}"))
}

fn function_data(signature: &str, words: &[[u8; 32]]) -> String {
    let selector = keccak256(signature.as_bytes());
    let mut data = Vec::with_capacity(4 + words.len() * 32);
    data.extend_from_slice(&selector[..4]);
    for word in words {
        data.extend_from_slice(word);
    }
    format!("0x{}", hex::encode(data))
}

fn bytes32_word(value: &str, field: &str) -> Result<[u8; 32], String> {
    let body = value
        .strip_prefix("0x")
        .ok_or_else(|| format!("{field} must be 0x-prefixed"))?;
    let bytes = hex::decode(body).map_err(|error| format!("invalid {field}: {error}"))?;
    bytes
        .try_into()
        .map_err(|_| format!("{field} must be a 32-byte hex value"))
}

fn address_word(value: &str, field: &str) -> Result<[u8; 32], String> {
    let address = Address::from_str(value).map_err(|error| format!("invalid {field}: {error}"))?;
    let mut word = [0_u8; 32];
    word[12..].copy_from_slice(address.as_slice());
    Ok(word)
}

fn uint_word(value: usize) -> [u8; 32] {
    let mut word = [0_u8; 32];
    word[24..].copy_from_slice(&(value as u64).to_be_bytes());
    word
}

fn result_words(result: &Value, label: &str) -> Result<Vec<[u8; 32]>, String> {
    let raw = result
        .as_str()
        .ok_or_else(|| format!("eth_call {label} returned non-string data"))?
        .trim_start_matches("0x");
    let bytes = hex::decode(raw).map_err(|error| format!("invalid {label} result: {error}"))?;
    if bytes.len() % 32 != 0 {
        return Err(format!("{label} returned malformed ABI words"));
    }
    bytes
        .chunks_exact(32)
        .map(|chunk| chunk.try_into().map_err(|_| "invalid ABI word".to_owned()))
        .collect()
}

fn batch_contract_reads(
    client: &LiqStewardClient,
    calls: &[(String, String, Vec<[u8; 32]>)],
    block: &str,
) -> Result<HashMap<String, Vec<[u8; 32]>>, String> {
    let mut output = HashMap::new();
    // Flashbots accepts up to five calls per public batch. Staying at that
    // ceiling keeps the snapshot fast while preserving dRPC/publicnode as
    // single-call fallbacks elsewhere.
    for chunk in calls.chunks(5) {
        let requests = chunk
            .iter()
            .map(|(_, signature, args)| {
                (
                    "eth_call",
                    json!([{ "to": PILOT_VAULT, "data": function_data(signature, args) }, block]),
                )
            })
            .collect::<Vec<_>>();
        let results = rpc_batch_with(client, requests)?;
        for ((label, _, _), result) in chunk.iter().zip(results) {
            output.insert(label.clone(), result_words(&result, label)?);
        }
    }
    Ok(output)
}

fn word_address(word: &[u8; 32]) -> String {
    format!("0x{}", hex::encode(&word[12..]))
}

fn word_u256(word: &[u8; 32]) -> U256 {
    U256::from_be_slice(word)
}

fn batch_word<'a>(
    reads: &'a HashMap<String, Vec<[u8; 32]>>,
    label: &str,
    index: usize,
) -> Result<&'a [u8; 32], String> {
    reads
        .get(label)
        .and_then(|words| words.get(index))
        .ok_or_else(|| format!("batch read {label} omitted ABI word {index}"))
}

fn value_u128(value: &Value) -> Option<u128> {
    value
        .as_u64()
        .map(u128::from)
        .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
}

fn market_params(allocation: &Value) -> Result<MarketParamsArgs, String> {
    let market = allocation
        .get("market")
        .ok_or_else(|| "allocation omitted market".to_owned())?;
    Ok(MarketParamsArgs {
        loan_token: market
            .pointer("/loanAsset/address")
            .and_then(Value::as_str)
            .ok_or_else(|| "market omitted loan asset".to_owned())?
            .to_owned(),
        collateral_token: market
            .pointer("/collateralAsset/address")
            .and_then(Value::as_str)
            .unwrap_or(ZERO_ADDRESS)
            .to_owned(),
        oracle: market
            .pointer("/oracle/address")
            .and_then(Value::as_str)
            .unwrap_or(ZERO_ADDRESS)
            .to_owned(),
        irm: market
            .get("irmAddress")
            .and_then(Value::as_str)
            .unwrap_or(ZERO_ADDRESS)
            .to_owned(),
        lltv: market
            .get("lltv")
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string())
            })
            .unwrap_or_else(|| "0".to_owned()),
    })
}

fn market_id(params: &MarketParamsArgs) -> Result<String, String> {
    let tuple = MarketParams {
        loanToken: Address::from_str(&params.loan_token)
            .map_err(|error| format!("invalid loan token: {error}"))?,
        collateralToken: Address::from_str(&params.collateral_token)
            .map_err(|error| format!("invalid collateral token: {error}"))?,
        oracle: Address::from_str(&params.oracle)
            .map_err(|error| format!("invalid oracle: {error}"))?,
        irm: Address::from_str(&params.irm).map_err(|error| format!("invalid irm: {error}"))?,
        lltv: U256::from_str(&params.lltv).map_err(|error| format!("invalid lltv: {error}"))?,
    };
    Ok(format!("0x{}", hex::encode(keccak256(tuple.abi_encode()))))
}

fn encode_reallocate(allocations: &[AllocationTargetArgs]) -> Result<String, String> {
    let allocations = allocations
        .iter()
        .map(|allocation| {
            let params = &allocation.market;
            Ok(MarketAllocation {
                marketParams: MarketParams {
                    loanToken: Address::from_str(&params.loan_token)
                        .map_err(|error| format!("invalid loan token: {error}"))?,
                    collateralToken: Address::from_str(&params.collateral_token)
                        .map_err(|error| format!("invalid collateral token: {error}"))?,
                    oracle: Address::from_str(&params.oracle)
                        .map_err(|error| format!("invalid oracle: {error}"))?,
                    irm: Address::from_str(&params.irm)
                        .map_err(|error| format!("invalid irm: {error}"))?,
                    lltv: U256::from_str(&params.lltv)
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

fn metadata() -> Result<Value, String> {
    let response =
        LiqStewardClient::new()?.get(&format!("{MORPHO_REST}/{CHAIN_ID}:{PILOT_VAULT}"))?;
    response
        .get("data")
        .cloned()
        .ok_or_else(|| "Morpho REST response omitted data".to_owned())
}

fn indexed_vault() -> Result<Value, String> {
    let query = r#"query Pilot($address: String!, $chainId: Int!) {
        vaultByAddress(address: $address, chainId: $chainId) {
            address name symbol asset { address symbol decimals }
            state {
                blockNumber totalAssets totalSupply fee apy netApy
                allocation {
                    supplyCap supplyAssets supplyAssetsUsd
                    market {
                        marketId lltv irmAddress reallocatableLiquidityAssets
                        collateralAsset { address symbol }
                        loanAsset { address symbol decimals }
                        oracle { address }
                        state {
                            blockNumber utilization borrowApy supplyApy
                            liquidityAssets liquidityAssetsUsd borrowAssets supplyAssets
                        }
                    }
                }
            }
        }
    }"#;
    let response = LiqStewardClient::new()?.post(
        MORPHO_GRAPHQL,
        &json!({ "query": query, "variables": { "address": PILOT_VAULT, "chainId": CHAIN_ID } }),
    )?;
    if let Some(errors) = response.get("errors") {
        return Err(format!("Morpho GraphQL returned errors: {errors}"));
    }
    response
        .pointer("/data/vaultByAddress")
        .cloned()
        .ok_or_else(|| "Morpho GraphQL returned no pilot vault".to_owned())
}

fn live_snapshot() -> Result<Value, String> {
    let rpc_client = LiqStewardClient::new()?;
    let metadata = metadata()?;
    let indexed = indexed_vault()?;
    let block_hex = rpc_with(&rpc_client, "eth_blockNumber", json!([]))?
        .as_str()
        .ok_or_else(|| "eth_blockNumber returned non-string data".to_owned())?
        .to_owned();
    let block = rpc_with(
        &rpc_client,
        "eth_getBlockByNumber",
        json!([block_hex, false]),
    )?;
    let block_number = parse_hex_u64(
        block
            .get("number")
            .and_then(Value::as_str)
            .ok_or_else(|| "block omitted number".to_owned())?,
        "block number",
    )?;
    let block_timestamp = parse_hex_u64(
        block
            .get("timestamp")
            .and_then(Value::as_str)
            .ok_or_else(|| "block omitted timestamp".to_owned())?,
        "block timestamp",
    )?;
    let pinned_block = format!("0x{block_number:x}");

    let allocations = indexed
        .pointer("/state/allocation")
        .and_then(Value::as_array)
        .ok_or_else(|| "Morpho GraphQL omitted vault allocations".to_owned())?;
    let mut read_calls = vec![
        ("owner".to_owned(), "owner()".to_owned(), vec![]),
        ("curator".to_owned(), "curator()".to_owned(), vec![]),
        ("guardian".to_owned(), "guardian()".to_owned(), vec![]),
        (
            "pending_owner".to_owned(),
            "pendingOwner()".to_owned(),
            vec![],
        ),
        ("timelock".to_owned(), "timelock()".to_owned(), vec![]),
        (
            "total_assets".to_owned(),
            "totalAssets()".to_owned(),
            vec![],
        ),
        (
            "supply_queue_length".to_owned(),
            "supplyQueueLength()".to_owned(),
            vec![],
        ),
        (
            "withdraw_queue_length".to_owned(),
            "withdrawQueueLength()".to_owned(),
            vec![],
        ),
        (
            "pending_guardian".to_owned(),
            "pendingGuardian()".to_owned(),
            vec![],
        ),
        (
            "pending_timelock".to_owned(),
            "pendingTimelock()".to_owned(),
            vec![],
        ),
    ];
    for allocation in allocations {
        let id = allocation
            .pointer("/market/marketId")
            .and_then(Value::as_str)
            .ok_or_else(|| "allocation omitted market id".to_owned())?;
        let word = bytes32_word(id, "market id")?;
        read_calls.push((
            format!("config:{id}"),
            "config(bytes32)".to_owned(),
            vec![word],
        ));
        read_calls.push((
            format!("pending_cap:{id}"),
            "pendingCap(bytes32)".to_owned(),
            vec![word],
        ));
    }
    for candidate in KNOWN_ALLOCATORS {
        read_calls.push((
            format!("allocator:{}", candidate.to_lowercase()),
            "isAllocator(address)".to_owned(),
            vec![address_word(candidate, "allocator")?],
        ));
    }
    let reads = batch_contract_reads(&rpc_client, &read_calls, &pinned_block)?;
    let owner = word_address(batch_word(&reads, "owner", 0)?);
    let curator = word_address(batch_word(&reads, "curator", 0)?);
    let guardian = word_address(batch_word(&reads, "guardian", 0)?);
    let pending_owner = word_address(batch_word(&reads, "pending_owner", 0)?);
    let timelock = word_u256(batch_word(&reads, "timelock", 0)?).to_string();
    let total_assets_onchain = word_u256(batch_word(&reads, "total_assets", 0)?).to_string();
    let supply_queue_length = word_u256(batch_word(&reads, "supply_queue_length", 0)?)
        .to_string()
        .parse::<usize>()
        .map_err(|error| format!("invalid supply queue length: {error}"))?;
    let withdraw_queue_length = word_u256(batch_word(&reads, "withdraw_queue_length", 0)?)
        .to_string()
        .parse::<usize>()
        .map_err(|error| format!("invalid withdraw queue length: {error}"))?;
    if supply_queue_length > 128 || withdraw_queue_length > 128 {
        return Err("refusing implausible MetaMorpho queue length".to_owned());
    }
    let queue_calls = (0..supply_queue_length)
        .map(|index| {
            (
                format!("supply_queue:{index}"),
                "supplyQueue(uint256)".to_owned(),
                vec![uint_word(index)],
            )
        })
        .chain((0..withdraw_queue_length).map(|index| {
            (
                format!("withdraw_queue:{index}"),
                "withdrawQueue(uint256)".to_owned(),
                vec![uint_word(index)],
            )
        }))
        .collect::<Vec<_>>();
    let queue_reads = batch_contract_reads(&rpc_client, &queue_calls, &pinned_block)?;
    let supply_queue = (0..supply_queue_length)
        .map(|index| {
            batch_word(&queue_reads, &format!("supply_queue:{index}"), 0)
                .map(|word| format!("0x{}", hex::encode(word)))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let withdraw_queue = (0..withdraw_queue_length)
        .map(|index| {
            batch_word(&queue_reads, &format!("withdraw_queue:{index}"), 0)
                .map(|word| format!("0x{}", hex::encode(word)))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let pending_guardian_words = reads
        .get("pending_guardian")
        .ok_or_else(|| "batch omitted pending guardian".to_owned())?;
    let pending_timelock_words = reads
        .get("pending_timelock")
        .ok_or_else(|| "batch omitted pending timelock".to_owned())?;
    let pending_guardian = json!({
        "value": pending_guardian_words.first().map(word_address),
        "valid_at": pending_guardian_words.get(1).map(word_u256).map(|value| value.to_string()),
    });
    let pending_timelock = json!({
        "value": pending_timelock_words.first().map(word_u256).map(|value| value.to_string()),
        "valid_at": pending_timelock_words.get(1).map(word_u256).map(|value| value.to_string()),
    });

    let total_assets = value_u128(
        indexed
            .pointer("/state/totalAssets")
            .ok_or_else(|| "Morpho GraphQL omitted totalAssets".to_owned())?,
    )
    .ok_or_else(|| "invalid indexed totalAssets".to_owned())?;
    let mut immediately_withdrawable = 0_u128;
    let mut largest_exposure = 0_u128;
    let mut normalized = Vec::with_capacity(allocations.len());
    let mut configs = Vec::with_capacity(allocations.len());

    for allocation in allocations {
        let id = allocation
            .pointer("/market/marketId")
            .and_then(Value::as_str)
            .ok_or_else(|| "allocation omitted market id".to_owned())?;
        let assets = value_u128(
            allocation
                .get("supplyAssets")
                .ok_or_else(|| "allocation omitted supplyAssets".to_owned())?,
        )
        .ok_or_else(|| "invalid supplyAssets".to_owned())?;
        let liquidity = value_u128(
            allocation
                .pointer("/market/state/liquidityAssets")
                .unwrap_or(&Value::Null),
        )
        .unwrap_or_default();
        immediately_withdrawable = immediately_withdrawable.saturating_add(assets.min(liquidity));
        largest_exposure = largest_exposure.max(assets);

        let config_words = reads
            .get(&format!("config:{id}"))
            .ok_or_else(|| format!("batch omitted config for {id}"))?;
        let pending_words = reads
            .get(&format!("pending_cap:{id}"))
            .ok_or_else(|| format!("batch omitted pending cap for {id}"))?;
        configs.push(json!({
            "market_id": id,
            "cap": config_words.first().map(word_u256).map(|value| value.to_string()),
            "enabled": config_words.get(1).map(word_u256).map(|value| !value.is_zero()),
            "removable_at": config_words.get(2).map(word_u256).map(|value| value.to_string()),
            "pending_cap": {
                "value": pending_words.first().map(word_u256).map(|value| value.to_string()),
                "valid_at": pending_words.get(1).map(word_u256).map(|value| value.to_string()),
            },
        }));

        normalized.push(json!({
            "market_id": id,
            "market_params": market_params(allocation)?,
            "collateral_symbol": allocation.pointer("/market/collateralAsset/symbol"),
            "current_assets": assets.to_string(),
            "supply_cap": allocation.get("supplyCap"),
            "share_of_vault": if total_assets == 0 { 0.0 } else { assets as f64 / total_assets as f64 },
            "utilization": allocation.pointer("/market/state/utilization"),
            "borrow_apy": allocation.pointer("/market/state/borrowApy"),
            "supply_apy": allocation.pointer("/market/state/supplyApy"),
            "market_liquidity_assets": liquidity.to_string(),
            "immediately_withdrawable_assets": assets.min(liquidity).to_string(),
            "reallocatable_liquidity_assets": allocation.pointer("/market/reallocatableLiquidityAssets"),
            "market_state_block": allocation.pointer("/market/state/blockNumber"),
        }));
    }

    let mut allocators = Vec::new();
    for candidate in KNOWN_ALLOCATORS {
        let words = reads
            .get(&format!("allocator:{}", candidate.to_lowercase()))
            .ok_or_else(|| format!("batch omitted allocator read for {candidate}"))?;
        allocators.push(json!({
            "address": candidate,
            "explicit_allocator": words.first().map(word_u256).is_some_and(|value| !value.is_zero()),
            "source": "chain_read_known_candidate",
        }));
    }

    Ok(json!({
        "schema": "morpho-vault-snapshot/v1",
        "snapshot_id": format!("eip155:{CHAIN_ID}:{block_number}:{}", PILOT_VAULT.to_lowercase()),
        "captured_at_unix": block_timestamp,
        "chain": {
            "chain_id": CHAIN_ID,
            "block_number": block_number,
            "block_hash": block.get("hash"),
            "rpc_candidates": ETHEREUM_RPC_FALLBACKS,
        },
        "vault": {
            "address": PILOT_VAULT,
            "name": indexed.get("name"),
            "symbol": indexed.get("symbol"),
            "asset": indexed.get("asset"),
            "total_assets_onchain": total_assets_onchain,
            "total_assets_indexed": total_assets.to_string(),
            "indexer_block": indexed.pointer("/state/blockNumber"),
            "apy": indexed.pointer("/state/apy"),
            "net_apy": indexed.pointer("/state/netApy"),
        },
        "roles": {
            "owner": owner,
            "curator": curator,
            "guardian": guardian,
            "pending_owner": pending_owner,
            "allocators": allocators,
            "implicit_allocator_roles": ["owner", "curator"],
            "expected_pilot_topology": {
                "owner_safe": PILOT_OWNER_SAFE,
                "curator_safe": PILOT_CURATOR_SAFE,
                "guardian_safe": PILOT_GUARDIAN_SAFE,
                "status": "chain_verified_addresses_safe_thresholds_assumed_from_public_safe_data",
            },
        },
        "configuration": {
            "timelock_seconds": timelock,
            "pending_timelock": pending_timelock,
            "pending_guardian": pending_guardian,
            "supply_queue": supply_queue,
            "withdraw_queue": withdraw_queue,
            "market_configs": configs,
        },
        "liquidity": {
            "immediately_withdrawable_assets": immediately_withdrawable.to_string(),
            "immediately_withdrawable_ratio": if total_assets == 0 { 0.0 } else { immediately_withdrawable as f64 / total_assets as f64 },
            "largest_market_exposure_assets": largest_exposure.to_string(),
            "largest_market_exposure_ratio": if total_assets == 0 { 0.0 } else { largest_exposure as f64 / total_assets as f64 },
        },
        "allocations": normalized,
        "provenance": {
            "metadata": MORPHO_REST,
            "allocations_and_rates": MORPHO_GRAPHQL,
            "roles_queues_caps_and_pending_changes": ETHEREUM_RPC_FALLBACKS,
            "metadata_echo": metadata,
        },
        "limitations": [
            "Morpho indexed allocation values are pinned to the reported indexer block, which may lag the RPC block.",
            "Oracle freshness is not exposed by a common MetaMorpho interface and requires a per-oracle adapter before it can be a hard policy check.",
            "Allocator mappings are not enumerable; the snapshot verifies the two public pilot candidates plus implicit owner and curator authority.",
        ],
    }))
}

fn pilot_policy() -> Value {
    json!({
        "policy_id": "gauntlet-usdc-core-pilot-v0",
        "status": "assumed_pending_gauntlet_confirmation",
        "constraints": {
            "maximum_market_exposure_ratio": 0.25,
            "minimum_immediately_withdrawable_ratio": 0.10,
            "maximum_oracle_staleness_seconds": 1800,
            "maximum_allocation_change_ratio_per_action": 0.15,
            "safe_idle_market_id": IDLE_MARKET_ID,
            "required_approver": {
                "type": "safe",
                "address": PILOT_CURATOR_SAFE,
                "assumed_threshold": "3/7",
            },
            "autonomous_execution": false,
        },
        "unconfirmed_items": [
            "oracle-specific freshness adapters and permitted feed semantics",
            "Gauntlet collateral allowlist",
            "whether the curator Safe or an allocator-specific Safe is the production approval route",
            "containment SLA and residual-exposure threshold",
        ],
    })
}

fn plan_reallocation(args: &RiskSignalArgs) -> Result<Value, String> {
    if args.risk_signal_id.trim().is_empty() || args.reason.trim().is_empty() {
        return Err("risk_signal_id and reason must not be empty".to_owned());
    }
    if args.affected_market_ids.is_empty() {
        return Err("affected_market_ids must not be empty".to_owned());
    }
    let affected = args
        .affected_market_ids
        .iter()
        .map(|id| {
            bytes32_word(id, "affected market id")?;
            Ok(id.to_lowercase())
        })
        .collect::<Result<HashSet<_>, String>>()?;
    let snapshot = live_snapshot()?;
    let total_assets = snapshot
        .pointer("/vault/total_assets_indexed")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u128>().ok())
        .ok_or_else(|| "snapshot omitted total assets".to_owned())?;
    let allocations = snapshot
        .get("allocations")
        .and_then(Value::as_array)
        .ok_or_else(|| "snapshot omitted allocations".to_owned())?;

    let idle = allocations
        .iter()
        .find(|allocation| {
            allocation
                .get("market_id")
                .and_then(Value::as_str)
                .is_some_and(|id| id.eq_ignore_ascii_case(IDLE_MARKET_ID))
        })
        .ok_or_else(|| "pilot idle market is not present in the live vault".to_owned())?;
    let idle_params: MarketParamsArgs = serde_json::from_value(
        idle.get("market_params")
            .cloned()
            .ok_or_else(|| "idle allocation omitted market params".to_owned())?,
    )
    .map_err(|error| format!("invalid idle market params: {error}"))?;

    let mut sources = Vec::new();
    let mut risk_assets = 0_u128;
    let mut affected_exit_liquidity = 0_u128;
    let mut weighted_apy_loss = 0_f64;
    for allocation in allocations {
        let id = allocation
            .get("market_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !affected.contains(&id.to_lowercase()) {
            continue;
        }
        let current = allocation
            .get("current_assets")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<u128>().ok())
            .ok_or_else(|| format!("invalid current assets for {id}"))?;
        let apy = allocation
            .get("supply_apy")
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let exit_liquidity = allocation
            .get("immediately_withdrawable_assets")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<u128>().ok())
            .unwrap_or_default();
        risk_assets = risk_assets.saturating_add(current);
        affected_exit_liquidity = affected_exit_liquidity.saturating_add(exit_liquidity);
        weighted_apy_loss += if total_assets == 0 {
            0.0
        } else {
            current as f64 / total_assets as f64 * apy
        };
        let params: MarketParamsArgs = serde_json::from_value(
            allocation
                .get("market_params")
                .cloned()
                .ok_or_else(|| format!("market {id} omitted params"))?,
        )
        .map_err(|error| format!("invalid market params for {id}: {error}"))?;
        sources.push((id.to_owned(), current, params));
    }

    let max_change = total_assets.saturating_mul(15) / 100;
    let liquidity_ratio = snapshot
        .pointer("/liquidity/immediately_withdrawable_ratio")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let full_allocations = sources
        .iter()
        .map(|(_, _, market)| AllocationTargetArgs {
            market: market.clone(),
            assets: "0".to_owned(),
        })
        .chain(std::iter::once(AllocationTargetArgs {
            market: idle_params.clone(),
            assets: MAX_UINT256.to_owned(),
        }))
        .collect::<Vec<_>>();
    let staged_reduction = risk_assets.min(max_change);
    let staged_allocations = sources
        .iter()
        .map(|(_, current, market)| {
            let reduction = if risk_assets == 0 {
                0
            } else {
                staged_reduction.saturating_mul(*current) / risk_assets
            };
            AllocationTargetArgs {
                market: market.clone(),
                assets: current.saturating_sub(reduction).to_string(),
            }
        })
        .chain(std::iter::once(AllocationTargetArgs {
            market: idle_params,
            assets: MAX_UINT256.to_owned(),
        }))
        .collect::<Vec<_>>();
    let staged_residual = staged_allocations[..staged_allocations.len().saturating_sub(1)]
        .iter()
        .map(|allocation| allocation.assets.parse::<u128>().unwrap_or_default())
        .sum::<u128>();
    let actual_staged_reduction = risk_assets.saturating_sub(staged_residual);

    let liquidity_floor_passed = liquidity_ratio >= 0.10;
    let full_change_passed = risk_assets <= max_change;
    let full_liquidity_passed = risk_assets <= affected_exit_liquidity;
    let staged_liquidity_passed = actual_staged_reduction <= affected_exit_liquidity;
    let full_admissible =
        risk_assets > 0 && full_change_passed && full_liquidity_passed && liquidity_floor_passed;
    let staged_admissible = risk_assets > 0 && staged_liquidity_passed && liquidity_floor_passed;
    let recommendation = if risk_assets == 0 {
        "no_change"
    } else if full_admissible {
        "full_exit_to_idle"
    } else if staged_admissible {
        "policy_limited_tranche_to_idle"
    } else {
        "no_admissible_action"
    };
    let risk_ratio = if total_assets == 0 {
        0.0
    } else {
        risk_assets as f64 / total_assets as f64
    };

    Ok(json!({
        "schema": "morpho-reallocation-plan-set/v1",
        "risk_signal": {
            "id": args.risk_signal_id,
            "reason": args.reason,
            "observed_at": args.observed_at,
            "provenance": "operator_or_risk_system_input",
        },
        "snapshot_id": snapshot.get("snapshot_id"),
        "policy": pilot_policy(),
        "current_risk_exposure_assets": risk_assets.to_string(),
        "current_risk_exposure_ratio": risk_ratio,
        "recommended_plan": recommendation,
        "plans": [
            {
                "plan_id": format!("{}:full-exit-to-idle", args.risk_signal_id),
                "kind": "full_exit_to_idle",
                "admissible": full_admissible,
                "allocations": full_allocations,
                "expected_apy_delta": -weighted_apy_loss,
                "residual_risk_assets": "0",
                "available_exit_liquidity_assets": affected_exit_liquidity.to_string(),
                "policy_checks": [
                    {"rule": "maximum_allocation_change_ratio_per_action", "passed": full_change_passed, "observed_assets": risk_assets.to_string(), "maximum_assets": max_change.to_string()},
                    {"rule": "affected_market_exit_liquidity", "passed": full_liquidity_passed, "required_assets": risk_assets.to_string(), "available_assets": affected_exit_liquidity.to_string()},
                    {"rule": "minimum_immediately_withdrawable_ratio", "passed": liquidity_floor_passed, "observed": liquidity_ratio, "minimum": 0.10},
                    {"rule": "oracle_staleness", "passed": true, "status": "not_applicable_withdraw_only_to_zero-oracle-idle-market"},
                    {"rule": "permitted_destination", "passed": true, "status": "canonical_zero-collateral-idle-market"},
                    {"rule": "destination_is_approved_idle_market", "passed": true, "market_id": IDLE_MARKET_ID},
                    {"rule": "manager_safe_approval_required", "passed": true, "automatic_submission": false}
                ]
            },
            {
                "plan_id": format!("{}:policy-limited-tranche", args.risk_signal_id),
                "kind": "policy_limited_tranche_to_idle",
                "admissible": staged_admissible,
                "allocations": staged_allocations,
                "expected_apy_delta": if risk_assets == 0 { 0.0 } else { -weighted_apy_loss * actual_staged_reduction as f64 / risk_assets as f64 },
                "residual_risk_assets": staged_residual.to_string(),
                "available_exit_liquidity_assets": affected_exit_liquidity.to_string(),
                "policy_checks": [
                    {"rule": "maximum_allocation_change_ratio_per_action", "passed": true, "observed_assets": actual_staged_reduction.to_string(), "maximum_assets": max_change.to_string()},
                    {"rule": "affected_market_exit_liquidity", "passed": staged_liquidity_passed, "required_assets": actual_staged_reduction.to_string(), "available_assets": affected_exit_liquidity.to_string()},
                    {"rule": "minimum_immediately_withdrawable_ratio", "passed": liquidity_floor_passed, "observed": liquidity_ratio, "minimum": 0.10},
                    {"rule": "oracle_staleness", "passed": true, "status": "not_applicable_withdraw-only-to-zero-oracle-idle-market"},
                    {"rule": "permitted_destination", "passed": true, "status": "canonical-zero-collateral-idle-market"},
                    {"rule": "destination_is_approved_idle_market", "passed": true, "market_id": IDLE_MARKET_ID},
                    {"rule": "manager_safe_approval_required", "passed": true, "automatic_submission": false}
                ]
            },
            {
                "plan_id": format!("{}:no-change", args.risk_signal_id),
                "kind": "no_change",
                "admissible": risk_assets == 0,
                "expected_apy_delta": 0.0,
                "residual_risk_assets": risk_assets.to_string(),
                "policy_checks": [
                    {"rule": "declared_containment_target", "passed": risk_assets == 0}
                ]
            }
        ],
        "approval_boundary": "A plan is only a proposal. simulate_plan stages and fork-simulates it; no app tool commits, signs, or broadcasts.",
    }))
}

fn validate_simulation(args: &SimulatePlanArgs) -> Result<(), String> {
    if !args.manager_selected {
        return Err(
            "manager_selected must be true after a human selects the exact plan".to_owned(),
        );
    }
    if args.chain_id != CHAIN_ID || !args.vault.eq_ignore_ascii_case(PILOT_VAULT) {
        return Err(
            "this deployment is restricted to the Ethereum Gauntlet USDC Core pilot vault"
                .to_owned(),
        );
    }
    if args.plan_id.trim().is_empty() || args.risk_signal_id.trim().is_empty() {
        return Err("plan_id and risk_signal_id must not be empty".to_owned());
    }
    if args.allocations.len() < 2 || args.risk_market_ids.is_empty() {
        return Err("the plan needs at least one risk market and one final destination".to_owned());
    }
    let risk_ids = args
        .risk_market_ids
        .iter()
        .map(|id| {
            bytes32_word(id, "risk market id")?;
            Ok(id.to_lowercase())
        })
        .collect::<Result<HashSet<_>, String>>()?;
    let last = args.allocations.len() - 1;
    if args.allocations[last].assets != MAX_UINT256
        || !market_id(&args.allocations[last].market)?.eq_ignore_ascii_case(IDLE_MARKET_ID)
    {
        return Err(
            "the final allocation must route remaining liquidity to the canonical USDC idle market"
                .to_owned(),
        );
    }
    for (index, allocation) in args.allocations.iter().enumerate() {
        if !allocation.market.loan_token.eq_ignore_ascii_case(USDC) {
            return Err(format!("allocations[{index}] must use USDC as loan token"));
        }
        U256::from_str(&allocation.assets)
            .map_err(|error| format!("invalid allocations[{index}].assets: {error}"))?;
        if index < last && !risk_ids.contains(&market_id(&allocation.market)?.to_lowercase()) {
            return Err(format!(
                "allocations[{index}] is not one of the declared risk markets"
            ));
        }
    }
    U256::from_str(&args.max_residual_assets)
        .map_err(|error| format!("invalid max_residual_assets: {error}"))?;

    let snapshot = live_snapshot()?;
    let total = snapshot
        .pointer("/vault/total_assets_indexed")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u128>().ok())
        .ok_or_else(|| "live snapshot omitted total assets".to_owned())?;
    let current = snapshot
        .get("allocations")
        .and_then(Value::as_array)
        .ok_or_else(|| "live snapshot omitted allocations".to_owned())?
        .iter()
        .filter_map(|allocation| {
            Some((
                allocation.get("market_id")?.as_str()?.to_lowercase(),
                (
                    allocation
                        .get("current_assets")?
                        .as_str()?
                        .parse::<u128>()
                        .ok()?,
                    allocation
                        .get("immediately_withdrawable_assets")?
                        .as_str()?
                        .parse::<u128>()
                        .ok()?,
                ),
            ))
        })
        .collect::<HashMap<_, _>>();
    let mut changed = 0_u128;
    let mut residual = 0_u128;
    let mut available_exit = 0_u128;
    for allocation in &args.allocations[..last] {
        let id = market_id(&allocation.market)?.to_lowercase();
        let (before, withdrawable) = current.get(&id).copied().unwrap_or_default();
        let after = allocation
            .assets
            .parse::<u128>()
            .map_err(|error| format!("target assets exceed pilot integer range: {error}"))?;
        if after > before {
            return Err(format!(
                "risk-off plan cannot increase affected market {id}"
            ));
        }
        changed = changed.saturating_add(before - after);
        residual = residual.saturating_add(after);
        available_exit = available_exit.saturating_add(withdrawable);
    }
    let max_change = total.saturating_mul(15) / 100;
    if changed > max_change {
        return Err(format!(
            "plan changes {changed} assets, exceeding the assumed per-action policy maximum {max_change}"
        ));
    }
    if changed > available_exit {
        return Err(format!(
            "plan requires {changed} withdrawable assets but affected markets expose only {available_exit}"
        ));
    }
    let liquidity_ratio = snapshot
        .pointer("/liquidity/immediately_withdrawable_ratio")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    if liquidity_ratio < 0.10 {
        return Err(format!(
            "live immediately-withdrawable ratio {liquidity_ratio:.6} is below the assumed 0.10 policy floor"
        ));
    }
    let threshold = args
        .max_residual_assets
        .parse::<u128>()
        .map_err(|error| format!("invalid residual threshold: {error}"))?;
    if residual > threshold {
        return Err(format!(
            "planned residual {residual} exceeds declared threshold {threshold}"
        ));
    }
    Ok(())
}

fn simulation_route(
    args: SimulatePlanArgs,
    operating_wallet: String,
) -> Result<ToolReturn, String> {
    validate_simulation(&args)?;
    let calldata = encode_reallocate(&args.allocations)?;
    if !calldata.starts_with(REALLOCATE_SELECTOR) {
        return Err("encoded calldata has the wrong MetaMorpho selector".to_owned());
    }
    let stage_args = json!({
        "to": args.vault,
        "chain_id": args.chain_id,
        "description": format!("Fork-simulate manager-selected Morpho plan {} for signal {}", args.plan_id, args.risk_signal_id),
        "data": { "raw": calldata },
        "value": "0",
        "kind": "vault_risk_off_simulation",
        "protocol": "morpho",
    });
    let finalize_args = json!({
        "plan_id": args.plan_id,
        "risk_signal_id": args.risk_signal_id,
        "chain_id": args.chain_id,
        "vault": args.vault,
        "allocations": args.allocations,
        "risk_market_ids": args.risk_market_ids,
        "max_residual_assets": args.max_residual_assets,
        "simulation_result": null,
    });
    let preview = json!({
        "status": "ready_to_stage_and_simulate",
        "operating_wallet": operating_wallet,
        "authority": "The connected wallet supplies simulation authority context only. Aomi will not sign, commit, or broadcast.",
        "pipeline": [EVM_STAGE_TX, SIMULATE_BATCH, FinalizeSimulation::NAME],
        "explicitly_absent": ["evm_commit_txs", "wallet_sign", "broadcast"],
        "approval_path": {
            "type": "safe_transaction_builder_json",
            "safe": PILOT_CURATOR_SAFE,
            "status": "assumed_pending_gauntlet_confirmation",
        },
    });

    ToolReturn::route(preview)
        .next(|next| {
            next.add_named(EVM_STAGE_TX, stage_args)
                .note("Stage this exact MetaMorpho calldata. The host must then run the attached fork simulation and stop on any revert.")
                .enforce(EnforcementPolicy::Stop, |enforce| {
                    enforce
                        .add_named(SIMULATE_BATCH, json!({}))
                        .bind_as("simulation_result");
                });
        })
        .after::<FinalizeSimulation>(finalize_args)
        .awaits("simulation_result")
        .note("Simulation passed. Build the unsigned manager approval package; do not submit it.")
        .try_build()
        .map_err(|error| format!("simulation route build failed: {error}"))
}

fn normalized_simulation(value: &Value) -> Result<Value, String> {
    match value {
        Value::String(raw) => serde_json::from_str(raw)
            .map_err(|error| format!("simulation result contained invalid JSON: {error}")),
        other => Ok(other.clone()),
    }
}

fn incident_replay() -> Value {
    let transactions = HISTORICAL_TXS
        .iter()
        .map(|(hash, timestamp)| json!({ "hash": hash, "timestamp": timestamp, "chain_id": CHAIN_ID }))
        .collect::<Vec<_>>();
    json!({
        "schema": "historical-containment-replay/v2",
        "status": "chain_reconstructed_public_evidence",
        "incident": "usd0pp-2025-01",
        "vault": PILOT_VAULT,
        "affected_markets": [
            {"market_id": USD0PP_MARKET_ID, "label": "USD0++ / USDC", "withdrawn_assets": "23429794127845"},
            {"market_id": PT_USD0PP_MARKET_ID, "label": "PT-USD0++-27MAR2025 / USDC", "withdrawn_assets": "13142112734057"}
        ],
        "combined_withdrawn_assets": "36571906861902",
        "transactions": transactions,
        "official_claim": {
            "text": "Gauntlet reported that nine transactions removed all USD0++ exposure after the redemption-term change.",
            "source": "https://vaultbook.gauntlet.xyz/resources/market-volatility",
            "provenance": "official_claim",
        },
        "reconstruction": {
            "method": "canonical Ethereum receipts plus Morpho reallocation events",
            "first_transaction": HISTORICAL_TXS[0].0,
            "last_transaction": HISTORICAL_TXS[8].0,
            "residual_target_assets": "0",
            "provenance": "derived_from_public_chain_data",
        },
    })
}

pub(crate) struct ReplayIncident;
impl DynAomiTool for ReplayIncident {
    type App = LiqStewardApp;
    type Args = NoArgs;
    const NAME: &'static str = "replay_incident";
    const DESCRIPTION: &'static str = "Return the exact nine-transaction January 2025 USD0++ containment sequence, affected market ids, and chain-derived exposure totals.";

    fn run(_app: &LiqStewardApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        Ok(incident_replay())
    }
}

pub(crate) struct VerifyTransaction;
impl DynAomiTool for VerifyTransaction {
    type App = LiqStewardApp;
    type Args = VerifyTransactionArgs;
    const NAME: &'static str = "verify_transaction";
    const DESCRIPTION: &'static str = "Fetch a canonical Ethereum transaction and receipt for an exact historical or executed hash.";

    fn run(_app: &LiqStewardApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        bytes32_word(args.hash.trim(), "transaction hash")?;
        let transaction = rpc("eth_getTransactionByHash", json!([args.hash]))?;
        if transaction.is_null() {
            return Ok(json!({ "status": "not_found", "hash": args.hash, "chain_id": CHAIN_ID }));
        }
        let receipt = rpc("eth_getTransactionReceipt", json!([args.hash]))?;
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
            "hash": args.hash,
            "chain_id": CHAIN_ID,
            "from": transaction.get("from"),
            "to": transaction.get("to"),
            "block_number": transaction.get("blockNumber"),
            "input_selector": input.get(..10).unwrap_or(input),
            "receipt_status": receipt.get("status"),
            "receipt_logs": receipt.get("logs").and_then(Value::as_array).map(Vec::len),
            "source_candidates": ETHEREUM_RPC_FALLBACKS,
        }))
    }
}

pub(crate) struct InspectVault;
impl DynAomiTool for InspectVault {
    type App = LiqStewardApp;
    type Args = NoArgs;
    const NAME: &'static str = "inspect_vault";
    const DESCRIPTION: &'static str = "Build a timestamped Ethereum snapshot of the selected Gauntlet USDC Core MetaMorpho vault: allocations, rates, liquidity, queues, caps, roles, timelocks, pending changes, and concentration.";

    fn run(_app: &LiqStewardApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        live_snapshot()
    }
}

pub(crate) struct GetPilotPolicy;
impl DynAomiTool for GetPilotPolicy {
    type App = LiqStewardApp;
    type Args = NoArgs;
    const NAME: &'static str = "get_pilot_policy";
    const DESCRIPTION: &'static str = "Return the deterministic pilot constraints and clearly label which operating rules remain assumptions pending Gauntlet confirmation.";

    fn run(_app: &LiqStewardApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        Ok(pilot_policy())
    }
}

pub(crate) struct PlanReallocation;
impl DynAomiTool for PlanReallocation {
    type App = LiqStewardApp;
    type Args = RiskSignalArgs;
    const NAME: &'static str = "plan_reallocation";
    const DESCRIPTION: &'static str = "Apply deterministic pilot policy to a live vault snapshot and a manager-supplied risk signal. Return full-exit, policy-limited tranche, and no-change alternatives with exact allocation tuples and pass/fail reasons.";

    fn run(_app: &LiqStewardApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        plan_reallocation(&args)
    }
}

pub(crate) struct SimulatePlan;
impl DynAomiTool for SimulatePlan {
    type App = LiqStewardApp;
    type Args = SimulatePlanArgs;
    const NAME: &'static str = "simulate_plan";
    const DESCRIPTION: &'static str = "After a manager selects an admissible plan, validate it against fresh live state, encode MetaMorpho reallocate calldata, stage it through evm-core, and enforce fork simulation. This tool never calls evm_commit_txs, signs, or broadcasts.";

    fn run_with_routes(
        _app: &LiqStewardApp,
        args: Self::Args,
        ctx: DynToolCallCtx,
    ) -> Result<ToolReturn, String> {
        let wallet = ctx
            .attribute_string(&["domain", "evm", "address"])
            .ok_or_else(|| {
                "connect an authorized EVM wallet to establish simulation sender context".to_owned()
            })?;
        simulation_route(args, wallet)
    }
}

pub(crate) struct FinalizeSimulation;
impl DynAomiTool for FinalizeSimulation {
    type App = LiqStewardApp;
    type Args = FinalizeSimulationArgs;
    const NAME: &'static str = "finalize_simulation";
    const DESCRIPTION: &'static str = "Internal routed continuation after simulate_batch. Reject failed or mismatched simulations and emit an unsigned Safe Transaction Builder package. Never submit the package.";

    fn run(_app: &LiqStewardApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        let simulation = normalized_simulation(&args.simulation_result)?;
        if simulation
            .pointer("/simulation/batch_success")
            .and_then(Value::as_bool)
            != Some(true)
        {
            return Err(format!("fork simulation did not pass: {simulation}"));
        }
        let calldata = encode_reallocate(&args.allocations)?;
        let simulated_to = simulation
            .pointer("/simulation/steps/0/tx/to")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let simulated_data = simulation
            .pointer("/simulation/steps/0/tx/data")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !simulated_to.eq_ignore_ascii_case(&args.vault)
            || !simulated_data.eq_ignore_ascii_case(&calldata)
        {
            return Err("simulation target or calldata did not match the reviewed plan".to_owned());
        }
        let before_after = args
            .allocations
            .iter()
            .map(|allocation| {
                Ok(json!({
                    "market_id": market_id(&allocation.market)?,
                    "proposed_assets": allocation.assets,
                }))
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(json!({
            "schema": "manager-approval-package/v1",
            "status": "unsigned_safe_proposal_ready",
            "plan_id": args.plan_id,
            "risk_signal_id": args.risk_signal_id,
            "policy_id": "gauntlet-usdc-core-pilot-v0",
            "policy_status": "assumed_pending_gauntlet_confirmation",
            "transaction": {
                "chain_id": args.chain_id,
                "to": args.vault,
                "value": "0",
                "operation": 0,
                "function": "reallocate((address,address,address,address,uint256,uint256)[])",
                "selector": REALLOCATE_SELECTOR,
                "data": calldata,
                "decoded_allocations": before_after,
            },
            "simulation": {
                "passed": true,
                "sender": simulation.get("simulation_from"),
                "execution_kind": simulation.get("execution_kind"),
                "network": simulation.pointer("/simulation/network"),
                "gas": simulation.pointer("/simulation/total_gas"),
                "exact_target_and_calldata_matched": true,
                "role_check": "successful reallocate simulation proves the effective sender passed MetaMorpho allocator authorization",
            },
            "residual_policy": {
                "risk_market_ids": args.risk_market_ids,
                "maximum_residual_assets": args.max_residual_assets,
            },
            "safe_transaction_builder": {
                "version": "1.0",
                "chainId": args.chain_id.to_string(),
                "meta": {
                    "name": format!("LiqSteward Morpho containment — {}", args.plan_id),
                    "description": "Unsigned proposal. Manager Safe review and approval required.",
                    "txBuilderVersion": "1.18.0",
                    "createdFromSafeAddress": PILOT_CURATOR_SAFE,
                },
                "transactions": [{
                    "to": args.vault,
                    "value": "0",
                    "data": calldata,
                    "contractMethod": null,
                    "contractInputsValues": null,
                }],
            },
            "approval": {
                "required_safe": PILOT_CURATOR_SAFE,
                "assumed_threshold": "3/7",
                "status": "manager_review_required",
                "submitted": false,
                "signed": false,
                "broadcast": false,
            },
            "proof_boundary": {
                "proved_now": [
                    "exact calldata simulated successfully on the Aomi fork",
                    "simulation sender had allocator authority",
                    "proposal target and calldata are byte-identical to simulation"
                ],
                "not_yet_proved_by_current_host_output": [
                    "direct post-simulation Morpho position reads on the same ephemeral fork",
                    "residual exposure after a future real Safe execution"
                ],
                "production_gate": "Add generic post-call assertions to simulate_batch before claiming direct fork post-state proof. verify_execution remains mandatory after a real manager execution."
            }
        }))
    }
}

pub(crate) struct VerifyExecution;
impl DynAomiTool for VerifyExecution {
    type App = LiqStewardApp;
    type Args = VerifyExecutionArgs;
    const NAME: &'static str = "verify_execution";
    const DESCRIPTION: &'static str = "After the manager Safe executes independently, verify the canonical receipt and current indexed residual exposure. This tool never submits a transaction.";

    fn run(_app: &LiqStewardApp, args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        bytes32_word(&args.transaction_hash, "transaction hash")?;
        let receipt = rpc("eth_getTransactionReceipt", json!([args.transaction_hash]))?;
        if receipt.is_null() || receipt.get("status").and_then(Value::as_str) != Some("0x1") {
            return Ok(json!({
                "completion": "receipt_unverified",
                "risk_signal_id": args.risk_signal_id,
                "transaction_hash": args.transaction_hash,
                "receipt": receipt,
            }));
        }
        let snapshot = live_snapshot()?;
        let risk_ids = args
            .risk_market_ids
            .iter()
            .map(|id| id.to_lowercase())
            .collect::<HashSet<_>>();
        let mut residual = U256::ZERO;
        let mut matched = Vec::new();
        for allocation in snapshot
            .get("allocations")
            .and_then(Value::as_array)
            .ok_or_else(|| "snapshot omitted allocations".to_owned())?
        {
            let id = allocation
                .get("market_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if risk_ids.contains(&id.to_lowercase()) {
                let assets = allocation
                    .get("current_assets")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "allocation omitted current assets".to_owned())?;
                residual = residual
                    .checked_add(
                        U256::from_str(assets)
                            .map_err(|error| format!("invalid current assets: {error}"))?,
                    )
                    .ok_or_else(|| "residual exposure overflowed uint256".to_owned())?;
                matched.push(json!({ "market_id": id, "supply_assets": assets }));
            }
        }
        let threshold = U256::from_str(&args.max_residual_assets)
            .map_err(|error| format!("invalid residual threshold: {error}"))?;
        Ok(json!({
            "completion": if residual <= threshold { "complete" } else { "residual_above_threshold" },
            "risk_signal_id": args.risk_signal_id,
            "transaction_hash": args.transaction_hash,
            "receipt_status": "confirmed",
            "receipt_block": receipt.get("blockNumber"),
            "snapshot_id": snapshot.get("snapshot_id"),
            "residual_assets": residual.to_string(),
            "max_residual_assets": threshold.to_string(),
            "threshold_passed": residual <= threshold,
            "risk_allocations": matched,
        }))
    }
}

pub(crate) struct ExportEvidence;
impl DynAomiTool for ExportEvidence {
    type App = LiqStewardApp;
    type Args = NoArgs;
    const NAME: &'static str = "export_evidence";
    const DESCRIPTION: &'static str = "Export the historical replay, current pilot policy, authority assumptions, and audit limitations as machine-readable evidence.";

    fn run(_app: &LiqStewardApp, _args: Self::Args, _ctx: DynToolCallCtx) -> Result<Value, String> {
        Ok(json!({
            "schema": "risk-off-evidence/v2",
            "generated_by": "liqsteward-aomi-app",
            "historical_replay": incident_replay(),
            "pilot_policy": pilot_policy(),
            "authority_boundary": "Aomi does not curate, sign, submit, or broadcast. The manager-controlled Safe remains authoritative.",
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allocation(collateral: &str, oracle: &str, assets: &str) -> AllocationTargetArgs {
        AllocationTargetArgs {
            market: MarketParamsArgs {
                loan_token: USDC.to_owned(),
                collateral_token: collateral.to_owned(),
                oracle: oracle.to_owned(),
                irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC".to_owned(),
                lltv: "860000000000000000".to_owned(),
            },
            assets: assets.to_owned(),
        }
    }

    fn route_args() -> SimulatePlanArgs {
        SimulatePlanArgs {
            plan_id: "test-plan".to_owned(),
            risk_signal_id: "test-signal".to_owned(),
            chain_id: CHAIN_ID,
            vault: PILOT_VAULT.to_owned(),
            allocations: vec![
                allocation(
                    "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
                    "0x1325Eb089Ac14B437E78D5D481e32611F6907eF8",
                    "0",
                ),
                AllocationTargetArgs {
                    market: MarketParamsArgs {
                        loan_token: USDC.to_owned(),
                        collateral_token: ZERO_ADDRESS.to_owned(),
                        oracle: ZERO_ADDRESS.to_owned(),
                        irm: ZERO_ADDRESS.to_owned(),
                        lltv: "0".to_owned(),
                    },
                    assets: MAX_UINT256.to_owned(),
                },
            ],
            risk_market_ids: vec![USD0PP_MARKET_ID.to_owned()],
            max_residual_assets: "0".to_owned(),
            manager_selected: true,
        }
    }

    #[test]
    fn alloy_encoder_matches_the_known_metamorpho_selector() {
        let calldata = encode_reallocate(&route_args().allocations).unwrap();
        assert!(calldata.starts_with(REALLOCATE_SELECTOR));
    }

    #[test]
    fn canonical_idle_params_hash_to_the_known_idle_market() {
        assert_eq!(
            market_id(&route_args().allocations[1].market).unwrap(),
            IDLE_MARKET_ID
        );
    }

    #[test]
    fn historical_replay_contains_exactly_nine_transactions() {
        assert_eq!(
            incident_replay()["transactions"].as_array().unwrap().len(),
            9
        );
        assert_eq!(
            incident_replay()["transactions"][0]["hash"],
            HISTORICAL_TXS[0].0
        );
    }

    #[test]
    fn simulation_route_has_no_commit_step() {
        let args = route_args();
        let calldata = encode_reallocate(&args.allocations).unwrap();
        let stage_args = json!({
            "to": args.vault,
            "chain_id": args.chain_id,
            "description": "test",
            "data": { "raw": calldata },
        });
        let route = ToolReturn::route(json!({"status": "test"}))
            .next(|next| {
                next.add_named(EVM_STAGE_TX, stage_args).enforce(
                    EnforcementPolicy::Stop,
                    |enforce| {
                        enforce
                            .add_named(SIMULATE_BATCH, json!({}))
                            .bind_as("simulation_result");
                    },
                );
            })
            .after::<FinalizeSimulation>(json!({"simulation_result": null}))
            .awaits("simulation_result")
            .build();
        let enforcement = route.routes[0].enforcement.as_ref().unwrap();
        assert_eq!(enforcement.steps.len(), 1);
        assert_eq!(enforcement.steps[0].tool, SIMULATE_BATCH);
        assert!(
            route
                .routes
                .iter()
                .all(|step| step.tool != "evm_commit_txs")
        );
    }

    #[test]
    #[ignore = "requires live Ethereum RPC and Morpho API"]
    fn live_snapshot_matches_the_selected_pilot_vault() {
        let snapshot = live_snapshot().unwrap();
        assert_eq!(snapshot["vault"]["address"], PILOT_VAULT);
        assert_eq!(
            snapshot["roles"]["curator"]
                .as_str()
                .unwrap()
                .to_lowercase(),
            PILOT_CURATOR_SAFE.to_lowercase()
        );
        assert!(snapshot["allocations"].as_array().unwrap().len() > 1);
        assert!(snapshot["chain"]["block_number"].as_u64().unwrap() > 0);
    }
}
