#!/usr/bin/env python3
"""Build the NAV oracle *vision* page: an illustrative, clearly labelled
synthetic scenario that exercises the real data model and tool protocol on a
deep position tree (nested vaults, a leveraged loop, a Pendle PT, an LP,
rewards, liabilities), a rich accounting policy, reconciliation breaks with
attribution, and a post-state residual-exposure verdict.

Usage: build-nav-vision.py --out apps/web/public/demo/nav-oracle-vision.html
"""
import argparse
import hashlib
import json

VAULT = "0xa11ce00000000000000000000000000000d3e0"
MORPHO = "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb"
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
USDE = "0x4c9edd5852cd905f086c759e8383e09bff1e68b3"
SUSDE = "0x9d39a5de30e57443bff2a8307a4256c8797a3497"
PT_SUSDE = "0x3b3fb9c57858ef816833dac1a6ee1f6b2f4d0e01"
WSTETH = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0"
PRIME = "0xb0b0000000000000000000000000000000c4a1"
LOOP = "0xc0c0000000000000000000000000000000100b"
CURVE_LP = "0xd0d000000000000000000000000000000cc11e"
SPECTRA_LP = "0xe0e0000000000000000000000000000000ab1e"
MORPHO_TOKEN = "0x58d97b57bb95320f9a05dc918aef65434969c2b2"
URD = "0x330eefa8a787552dc5cad7c8d5b7f3de0c9ec3fa"
PIN = 25_951_212
PIN_HASH = "0x4d2f9e0b6ac3f2c9b18a7e5d4c3b2a19f8e7d6c5b4a39281706f5e4d3c2b1a09"
POLICY_DIGEST = "0x9c1e7a2b5d4f3e6c8a0b1d2f4e6a8c0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a1c"

def h(*parts):
    return "0x" + hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()

def ev(target, sig, args, decoded_by, source="evm_reads", words=1):
    raw = "0x" + "".join(hashlib.sha256(f"{target}{sig}{args}{i}".encode()).hexdigest() for i in range(words))
    e = {"source": source, "target": target, "function_signature": sig, "arguments": args, "served_block": PIN,
         "result_keccak": h("k", target, sig, args), "raw_result": raw, "decoded_by": decoded_by}
    if source == "evm_sim":
        e["block_hash"] = PIN_HASH
        e["seq"] = 1
    return e

def node(nid, kind, status, contract, account, adapter, quantity=None, value=None, market=None,
         posted=None, price=None, boundary=None, unresolved=None, evidence=None, look_through=False, note=None):
    n = {
        "node_id": nid, "kind": kind, "status": status, "contract": contract, "account": account,
        "market_id": market, "semantic": {"adapter_id": adapter, "adapter_version": "1.0.0"},
        "boundary": boundary or {"in_scope": True, "rule": "scope.owned_accounts"},
        "quantity": quantity, "value_base": value, "posted_views": posted or [], "price": price,
        "unresolved": unresolved, "evidence": evidence or [], "look_through": look_through, "note": note,
    }
    return n

# ── pre-state DAG ──
def pre_nodes():
    N = []
    N.append(node("n_root", "account", "verified", VAULT, VAULT, "metamorpho_vault",
        posted=[{"view_id": "metamorpho.total_assets", "value": 13_843_461.00},
                {"view_id": "metamorpho.last_total_assets", "value": 13_790_120.00}],
        evidence=[ev(VAULT, "totalAssets()", [], "metamorpho_vault@1.0.0"), ev(VAULT, "lastTotalAssets()", [], "metamorpho_vault@1.0.0"),
                  ev(VAULT, "asset()", [], "metamorpho_vault@1.0.0"), ev(VAULT, "MORPHO()", [], "metamorpho_vault@1.0.0"),
                  ev(VAULT, "withdrawQueueLength()", [], "metamorpho_vault@1.0.0")]
                 + [ev(VAULT, "withdrawQueue(uint256)", [str(i)], "metamorpho_vault@1.0.0") for i in range(2)]
                 + [ev(VAULT, "strategies(uint256)", [str(i)], "metamorpho_vault@1.0.0") for i in range(5)]))
    # layer 1
    N.append(node("n_idle", "token_balance", "priced", USDC, VAULT, "erc20_balance",
        {"raw": 1_250_000.00, "symbol": "USDC", "decimals": 6}, 1_250_000.00,
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(USDC, "balanceOf(address)", [VAULT], "erc20_balance@1.0.0"), ev(USDC, "decimals()", [], "erc20_balance@1.0.0"), ev(USDC, "symbol()", [], "erc20_balance@1.0.0")]))
    N.append(node("n_mkt_wsteth", "lending_supply", "priced", MORPHO, VAULT, "morpho_blue_market",
        {"raw": 4_800_000.00, "symbol": "USDC", "decimals": 6}, 4_800_000.00, market=h("m", "wsteth")[:66],
        posted=[{"view_id": "morpho_market.shares_to_assets", "value": 4_800_000.00}, {"view_id": "morpho_market.expected_supply_assets", "value": 4_817_631.00}],
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(MORPHO, "position(bytes32,address)", ["0x…wsteth", VAULT], "morpho_blue_market@1.0.0", words=3), ev(MORPHO, "market(bytes32)", ["0x…wsteth"], "morpho_blue_market@1.0.0", words=6),
                  ev(MORPHO, "idToMarketParams(bytes32)", ["0x…wsteth"], "morpho_blue_market@1.0.0", words=5), ev("0x870ac11d48b15db9a138cf899d20f13f79ba00bc", "borrowRateView(...)", ["…"], "morpho_blue_market@1.0.0")],
        note="USDC / wstETH 86% LLTV"))
    N.append(node("n_mkt_ptsusde", "lending_supply", "priced", MORPHO, VAULT, "morpho_blue_market",
        {"raw": 3_200_000.00, "symbol": "USDC", "decimals": 6}, 3_200_000.00, market=h("m", "ptsusde")[:66],
        posted=[{"view_id": "morpho_market.shares_to_assets", "value": 3_200_000.00}, {"view_id": "morpho_market.expected_supply_assets", "value": 3_206_210.00}],
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(MORPHO, "position(bytes32,address)", ["0x…ptsusde", VAULT], "morpho_blue_market@1.0.0", words=3), ev(MORPHO, "market(bytes32)", ["0x…ptsusde"], "morpho_blue_market@1.0.0", words=6), ev(MORPHO, "idToMarketParams(bytes32)", ["0x…ptsusde"], "morpho_blue_market@1.0.0", words=5)],
        note="USDC / PT-sUSDe-27MAR2027 91.5% LLTV · risk market"))
    N.append(node("n_vs_prime", "vault_share", "verified", PRIME, VAULT, "erc4626_generic",
        {"raw": 1_912_044.12, "symbol": "primeUSDC", "decimals": 18}, 2_000_000.00, look_through=True,
        posted=[{"view_id": "erc4626.convert_to_assets", "value": 2_012_500.00}],
        evidence=[ev(PRIME, "asset()", [], "erc4626_generic@1.0.0"), ev(PRIME, "balanceOf(address)", [VAULT], "erc4626_generic@1.0.0"), ev(PRIME, "convertToAssets(uint256)", ["1912044120000000000000000"], "erc4626_generic@1.0.0")],
        note="Nested ERC-4626: Prime sUSDe Carry. Valued look-through, not at the vault's own conversion."))
    N.append(node("n_vs_loop", "vault_share", "verified", LOOP, VAULT, "morpho_loop_strategy",
        {"raw": 1_000_000.00, "symbol": "loopUSDe", "decimals": 18}, 1_050_000.00, look_through=True,
        posted=[{"view_id": "erc4626.convert_to_assets", "value": 1_110_000.00}],
        evidence=[ev(LOOP, "asset()", [], "morpho_loop_strategy@1.0.0"), ev(LOOP, "balanceOf(address)", [VAULT], "morpho_loop_strategy@1.0.0"), ev(LOOP, "convertToAssets(uint256)", ["1000000000000000000000000"], "morpho_loop_strategy@1.0.0")],
        note="sUSDe/USDC leveraged loop, 3.3x. Collateral and debt are separate nodes."))
    N.append(node("n_lp_curve", "lp_position", "verified", CURVE_LP, VAULT, "curve_stable_lp",
        {"raw": 897_410.55, "symbol": "crvUSDC-USDe", "decimals": 18}, 901_010.00, look_through=True,
        posted=[{"view_id": "curve.virtual_price_value", "value": 901_300.00}],
        evidence=[ev(CURVE_LP, "balanceOf(address)", [VAULT], "curve_stable_lp@1.0.0"), ev(CURVE_LP, "get_virtual_price()", [], "curve_stable_lp@1.0.0"), ev(CURVE_LP, "balances(uint256)", ["0"], "curve_stable_lp@1.0.0"), ev(CURVE_LP, "balances(uint256)", ["1"], "curve_stable_lp@1.0.0"), ev(CURVE_LP, "totalSupply()", [], "curve_stable_lp@1.0.0")],
        note="Curve USDC/USDe. Valued by pro-rata underlying balances, not virtual price."))
    N.append(node("n_pt_direct", "pt_position", "priced", PT_SUSDE, VAULT, "pendle_pt",
        {"raw": 600_000.00, "symbol": "PT-sUSDe-27MAR2027", "decimals": 18}, 556_249.28,
        posted=[{"view_id": "pendle.pt_to_asset_rate", "value": 564_720.00}],
        price={"source": "ext:pendle:twap:30m", "price": 0.9412, "secondary": "ext:pendle:spot", "secondary_price": 0.9250, "deviation_bps": 173, "confidence": "reference", "haircut_bps": 150},
        evidence=[ev(PT_SUSDE, "balanceOf(address)", [VAULT], "pendle_pt@1.0.0"), ev(PT_SUSDE, "expiry()", [], "pendle_pt@1.0.0"), ev(PT_SUSDE, "SY()", [], "pendle_pt@1.0.0")],
        note="Directly held principal token. 30-minute TWAP with spot as secondary; deviation above the alert line."))
    N.append(node("n_claim_rewards", "claimable", "priced", URD, VAULT, "morpho_urd_claimable",
        {"raw": 18_400.00, "symbol": "MORPHO", "decimals": 18}, 13_064.00,
        price={"source": "ext:coingecko:morpho", "price": 1.42, "confidence": "reference", "haircut_bps": 5000, "staleness_s": 412},
        evidence=[ev(URD, "claimed(address,address)", [VAULT, MORPHO_TOKEN], "morpho_urd_claimable@1.0.0")],
        note="Unclaimed URD rewards. Policy haircuts reward tokens 50%."))
    N.append(node("n_liab_fee", "liability", "priced", VAULT, VAULT, "metamorpho_vault",
        {"raw": 12_400.00, "symbol": "USDC", "decimals": 6}, 12_400.00,
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(VAULT, "fee()", [], "metamorpho_vault@1.0.0"), ev(VAULT, "lastTotalAssets()", [], "metamorpho_vault@1.0.0")],
        note="Accrued performance fee not yet minted as shares."))
    N.append(node("n_lp_spectra", "lp_position", "unresolved", SPECTRA_LP, VAULT, "spectra_lp",
        boundary={"in_scope": False, "rule": "exclusions: no adapter for spectra_lp; manager attests < 0.1% of NAV"},
        unresolved={"reason": "adapter_unknown", "detail": "policy does not allow adapter spectra_lp", "attempts": 0},
        note="Discovered by the vault's strategies() list. Excluded by policy until an adapter ships; still visible."))
    # layer 2
    N.append(node("n_prime_mkt", "lending_supply", "priced", MORPHO, PRIME, "morpho_blue_market",
        {"raw": 1_950_000.00, "symbol": "USDC", "decimals": 6}, 1_950_000.00, market=h("m", "prime")[:66],
        posted=[{"view_id": "morpho_market.shares_to_assets", "value": 1_950_000.00}, {"view_id": "morpho_market.expected_supply_assets", "value": 1_952_900.00}],
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(MORPHO, "position(bytes32,address)", ["0x…prime", PRIME], "morpho_blue_market@1.0.0", words=3), ev(MORPHO, "market(bytes32)", ["0x…prime"], "morpho_blue_market@1.0.0", words=6)],
        note="Prime's own supply: USDC / sUSDe 91.5% LLTV. Account is the Prime vault, not ours."))
    N.append(node("n_prime_idle", "token_balance", "priced", USDC, PRIME, "erc20_balance",
        {"raw": 50_000.00, "symbol": "USDC", "decimals": 6}, 50_000.00,
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(USDC, "balanceOf(address)", [PRIME], "erc20_balance@1.0.0")]))
    N.append(node("n_loop_coll", "token_balance", "priced", SUSDE, LOOP, "erc4626_generic",
        {"raw": 2_083_333.00, "symbol": "sUSDe", "decimals": 18}, 2_450_000.00,
        posted=[{"view_id": "erc4626.convert_to_assets", "value": 2_475_000.00}],
        price={"source": "chain:erc4626:sUSDe→USDe", "price": 1.1760, "via": "USDe", "confidence": "authoritative", "haircut_bps": 100},
        evidence=[ev(MORPHO, "position(bytes32,address)", ["0x…loop", LOOP], "morpho_blue_market@1.0.0", words=3), ev(SUSDE, "convertToAssets(uint256)", ["2083333000000000000000000"], "erc4626_generic@1.0.0")],
        note="sUSDe posted as Morpho collateral by the loop. Priced through USDe with a 100 bps haircut."))
    N.append(node("n_loop_debt", "lending_debt", "priced", MORPHO, LOOP, "morpho_blue_market",
        {"raw": 1_400_000.00, "symbol": "USDC", "decimals": 6}, 1_400_000.00, market=h("m", "loop")[:66],
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(MORPHO, "position(bytes32,address)", ["0x…loop", LOOP], "morpho_blue_market@1.0.0", words=3), ev(MORPHO, "market(bytes32)", ["0x…loop"], "morpho_blue_market@1.0.0", words=6)],
        note="Borrow shares converted up. Subtracted from NAV."))
    N.append(node("n_lp_usdc", "token_balance", "priced", USDC, CURVE_LP, "curve_stable_lp",
        {"raw": 452_000.00, "symbol": "USDC", "decimals": 6}, 452_000.00,
        price={"source": "policy:par", "price": 1, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(CURVE_LP, "balances(uint256)", ["0"], "curve_stable_lp@1.0.0")], note="Pro-rata share of pool USDC."))
    N.append(node("n_lp_usde", "token_balance", "priced", USDE, CURVE_LP, "curve_stable_lp",
        {"raw": 449_190.00, "symbol": "USDe", "decimals": 18}, 449_010.00,
        price={"source": "chain:chainlink:USDe/USD", "price": 0.9996, "secondary": "ext:coingecko:ethena-usde", "secondary_price": 0.9993, "deviation_bps": 3, "confidence": "authoritative", "haircut_bps": 0},
        evidence=[ev(CURVE_LP, "balances(uint256)", ["1"], "curve_stable_lp@1.0.0")], note="Pro-rata share of pool USDe."))
    # layer 3
    N.append(node("n_price_usde", "price", "verified", "0xa569d910839ae8d8b3d7bb7b30c9ce2ce55f5aa5", VAULT, "chainlink_feed",
        {"raw": 0.9996, "symbol": "USDe/USD", "decimals": 8},
        evidence=[ev("0xa569d910839ae8d8b3d7bb7b30c9ce2ce55f5aa5", "latestRoundData()", [], "chainlink_feed@1.0.0", words=5)],
        note="Chainlink USDe/USD read at the pin; secondary CoinGecko 0.9993 (3 bps)."))
    N.append(node("n_price_susde", "price", "verified", SUSDE, VAULT, "erc4626_generic",
        {"raw": 1.1760, "symbol": "sUSDe/USDe", "decimals": 18},
        posted=[{"view_id": "erc4626.convert_to_assets", "value": 1.1760}],
        evidence=[ev(SUSDE, "convertToAssets(uint256)", ["1000000000000000000"], "erc4626_generic@1.0.0")],
        note="sUSDe → USDe through the vault's own conversion, then USDe → USD through Chainlink."))
    # layer 4
    N.append(node("n_usde_backing", "claimable", "excluded", USDE, VAULT, "none",
        boundary={"in_scope": False, "rule": "exclusions: off-chain custodian reserves are not chain-verifiable"},
        note="USDe's reserve backing lives with custodians. The policy stops the traversal here and says why."))
    return N

PRE_EDGES = [
    ("n_root", "n_idle", "owns"), ("n_root", "n_mkt_wsteth", "owns"), ("n_root", "n_mkt_ptsusde", "owns"),
    ("n_root", "n_vs_prime", "owns"), ("n_root", "n_vs_loop", "owns"), ("n_root", "n_lp_curve", "owns"),
    ("n_root", "n_pt_direct", "owns"), ("n_root", "n_claim_rewards", "owns"), ("n_root", "n_liab_fee", "owes"),
    ("n_root", "n_lp_spectra", "owns"),
    ("n_vs_prime", "n_prime_mkt", "represents"), ("n_vs_prime", "n_prime_idle", "represents"),
    ("n_vs_loop", "n_loop_coll", "represents"), ("n_vs_loop", "n_loop_debt", "owes"),
    ("n_lp_curve", "n_lp_usdc", "represents"), ("n_lp_curve", "n_lp_usde", "represents"),
    ("n_loop_coll", "n_price_susde", "priced_by"), ("n_price_susde", "n_price_usde", "priced_by"),
    ("n_lp_usde", "n_price_usde", "priced_by"), ("n_pt_direct", "n_price_susde", "priced_by"),
    ("n_price_usde", "n_usde_backing", "backs"),
]

def post_nodes():
    N = pre_nodes()
    by = {n["node_id"]: n for n in N}
    for n in N:
        for e in n["evidence"]:
            e["source"] = "evm_sim"; e["block_hash"] = PIN_HASH; e["seq"] = 2
    by["n_idle"]["quantity"]["raw"] = 4_210_000.00; by["n_idle"]["value_base"] = 4_210_000.00
    by["n_mkt_ptsusde"]["quantity"]["raw"] = 240_000.00; by["n_mkt_ptsusde"]["value_base"] = 240_000.00
    by["n_mkt_ptsusde"]["posted_views"] = [{"view_id": "morpho_market.shares_to_assets", "value": 240_000.00}]
    by["n_mkt_ptsusde"]["note"] = "After reallocate: only 2,960,000 of 3,200,000 could leave; market liquidity capped the withdrawal. 240,000 remains."
    by["n_root"]["posted_views"] = [{"view_id": "metamorpho.total_assets", "value": 13_843_461.00}, {"view_id": "metamorpho.last_total_assets", "value": 13_843_461.00}]
    return N

PRE_CHECKS = [
    {"id": "vault_total_assets", "scope": "vault", "posted_view": "metamorpho.total_assets", "observed": 13_757_923.28, "posted": 13_843_461.00, "delta_bps": 62, "tolerance_bps": 25, "severity": "critical", "verdict": "fail"},
    {"id": "vault_last_total_assets", "scope": "vault", "posted_view": "metamorpho.last_total_assets", "observed": 13_757_923.28, "posted": 13_790_120.00, "delta_bps": 23, "tolerance_bps": 50, "severity": "info", "verdict": "pass"},
    {"id": "market_shares", "scope": "per_node", "node_id": "n_mkt_wsteth", "posted_view": "morpho_market.shares_to_assets", "observed": 4_800_000.00, "posted": 4_800_000.00, "delta_bps": 0, "tolerance_bps": 0, "severity": "warn", "verdict": "pass"},
    {"id": "market_shares", "scope": "per_node", "node_id": "n_mkt_ptsusde", "posted_view": "morpho_market.shares_to_assets", "observed": 3_200_000.00, "posted": 3_200_000.00, "delta_bps": 0, "tolerance_bps": 0, "severity": "warn", "verdict": "pass"},
    {"id": "market_shares", "scope": "per_node", "node_id": "n_prime_mkt", "posted_view": "morpho_market.shares_to_assets", "observed": 1_950_000.00, "posted": 1_950_000.00, "delta_bps": 0, "tolerance_bps": 0, "severity": "warn", "verdict": "pass"},
    {"id": "market_accrual", "scope": "per_node", "node_id": "n_mkt_wsteth", "posted_view": "morpho_market.expected_supply_assets", "observed": 4_800_000.00, "posted": 4_817_631.00, "delta_bps": 37, "tolerance_bps": 25, "severity": "warn", "verdict": "fail"},
    {"id": "market_accrual", "scope": "per_node", "node_id": "n_mkt_ptsusde", "posted_view": "morpho_market.expected_supply_assets", "observed": 3_200_000.00, "posted": 3_206_210.00, "delta_bps": 19, "tolerance_bps": 25, "severity": "warn", "verdict": "pass"},
    {"id": "market_accrual", "scope": "per_node", "node_id": "n_prime_mkt", "posted_view": "morpho_market.expected_supply_assets", "observed": 1_950_000.00, "posted": 1_952_900.00, "delta_bps": 15, "tolerance_bps": 25, "severity": "warn", "verdict": "pass"},
    {"id": "nested_vault_conversion", "scope": "per_node", "node_id": "n_vs_prime", "posted_view": "erc4626.convert_to_assets", "observed": 2_000_000.00, "posted": 2_012_500.00, "delta_bps": 62, "tolerance_bps": 25, "severity": "critical", "verdict": "fail"},
    {"id": "nested_vault_conversion", "scope": "per_node", "node_id": "n_vs_loop", "posted_view": "erc4626.convert_to_assets", "observed": 1_050_000.00, "posted": 1_110_000.00, "delta_bps": 541, "tolerance_bps": 50, "severity": "critical", "verdict": "fail"},
    {"id": "collateral_conversion", "scope": "per_node", "node_id": "n_loop_coll", "posted_view": "erc4626.convert_to_assets", "observed": 2_450_000.00, "posted": 2_475_000.00, "delta_bps": 101, "tolerance_bps": 110, "severity": "info", "verdict": "pass"},
    {"id": "pt_rate", "scope": "per_node", "node_id": "n_pt_direct", "posted_view": "pendle.pt_to_asset_rate", "observed": 556_249.28, "posted": 564_720.00, "delta_bps": 150, "tolerance_bps": 160, "severity": "info", "verdict": "pass"},
    {"id": "lp_virtual_price", "scope": "per_node", "node_id": "n_lp_curve", "posted_view": "curve.virtual_price_value", "observed": 901_010.00, "posted": 901_300.00, "delta_bps": 3, "tolerance_bps": 20, "severity": "info", "verdict": "pass"},
]

PRE_BREAKS = [
    {"break_id": "brk_01", "kind": "reconciliation", "check_id": "vault_total_assets", "severity": "critical", "observed": "13,757,923.28", "bound": "13,843,461.00 ± 25 bps", "node_ids": ["n_root"], "status": "open",
     "attribution": [{"node_id": "n_vs_loop", "amount": 60_000.00, "why": "loop vault marks sUSDe at 1.2000; policy prices it at 1.1760 (Chainlink USDe × sUSDe conversion) with a 100 bps haircut"},
                     {"node_id": "n_mkt_wsteth", "amount": 17_631.00, "why": "vault counts accrued interest not yet written to Morpho storage"},
                     {"node_id": "n_vs_prime", "amount": 12_500.00, "why": "Prime's convertToAssets uses its own oracle for the sUSDe market; look-through disagrees"},
                     {"node_id": "n_pt_direct", "amount": 8_471.00, "why": "vault values PT at the Pendle rate with no haircut; policy applies 150 bps"},
                     {"node_id": "n_claim_rewards", "amount": -13_064.00, "why": "vault ignores unclaimed MORPHO; policy counts it at 50%"}],
     "history": [{"status": "open", "changed_by": "compile", "at": "2026-09-11T09:14:03Z", "note": "62 bps off metamorpho.total_assets; fully attributed"}]},
    {"break_id": "brk_02", "kind": "reconciliation", "check_id": "nested_vault_conversion", "severity": "critical", "observed": "1,050,000.00", "bound": "1,110,000.00 ± 50 bps", "node_ids": ["n_vs_loop"], "status": "explained",
     "history": [{"status": "open", "changed_by": "compile", "at": "2026-09-11T09:14:03Z", "note": "541 bps off erc4626.convert_to_assets"}, {"status": "explained", "changed_by": "risk.lead", "at": "2026-09-11T09:41:00Z", "note": "Loop vault oracle is a 24h TWAP of sUSDe; policy uses spot conversion. Keep policy; raise with strategy owner."}]},
    {"break_id": "brk_03", "kind": "reconciliation", "check_id": "nested_vault_conversion", "severity": "critical", "observed": "2,000,000.00", "bound": "2,012,500.00 ± 25 bps", "node_ids": ["n_vs_prime"], "status": "open",
     "history": [{"status": "open", "changed_by": "compile", "at": "2026-09-11T09:14:03Z", "note": "62 bps off erc4626.convert_to_assets"}]},
    {"break_id": "brk_04", "kind": "reconciliation", "check_id": "market_accrual", "severity": "warn", "observed": "4,800,000.00", "bound": "4,817,631.00 ± 25 bps", "node_ids": ["n_mkt_wsteth"], "status": "open",
     "history": [{"status": "open", "changed_by": "compile", "at": "2026-09-11T09:14:03Z", "note": "37 bps of unaccrued interest; market last touched 31h ago"}]},
    {"break_id": "brk_05", "kind": "price_deviation", "check_id": "pricing.PT-sUSDe", "severity": "warn", "observed": "173 bps twap vs spot", "bound": "alert 100 bps · refuse above 200", "node_ids": ["n_pt_direct"], "status": "open",
     "history": [{"status": "open", "changed_by": "price_nodes", "at": "2026-09-11T09:13:40Z", "note": "priced at twap with 150 bps haircut; would refuse above 200"}]},
    {"break_id": "brk_06", "kind": "boundary", "check_id": "scope.exclusions", "severity": "info", "observed": "1 position unresolved, out of scope", "bound": "adapter spectra_lp missing", "node_ids": ["n_lp_spectra"], "status": "explained",
     "history": [{"status": "open", "changed_by": "write_to_dag", "at": "2026-09-11T09:09:12Z", "note": "adapter_unknown"}, {"status": "explained", "changed_by": "risk.lead", "at": "2026-09-11T09:20:00Z", "note": "< 0.1% NAV; adapter requested"}]},
]

POST_CHECKS = [
    {"id": "residual_exposure", "scope": "vault", "posted_view": "plan.max_residual_assets", "observed": 240_000.00, "posted": 100_000.00, "delta_bps": 14000, "tolerance_bps": 0, "severity": "critical", "verdict": "fail"},
    {"id": "conservation", "scope": "vault", "posted_view": "pre.nav_base", "observed": 13_757_923.28, "posted": 13_757_923.28, "delta_bps": 0, "tolerance_bps": 5, "severity": "critical", "verdict": "pass"},
    {"id": "vault_total_assets", "scope": "vault", "posted_view": "metamorpho.total_assets", "observed": 13_757_923.28, "posted": 13_843_461.00, "delta_bps": 62, "tolerance_bps": 25, "severity": "critical", "verdict": "fail"},
]
POST_BREAKS = [
    {"break_id": "brk_p1", "kind": "residual_exposure", "check_id": "residual_exposure", "severity": "critical", "observed": "240,000.00 USDC still supplied to the PT-sUSDe market", "bound": "plan allows 100,000.00", "node_ids": ["n_mkt_ptsusde"], "status": "open",
     "history": [{"status": "open", "changed_by": "compile", "at": "2026-09-11T09:31:15Z", "note": "market liquidity capped the exit at 2,960,000; a second tranche is needed before the Safe signs"}]},
]

TOTALS_PRE = {"assets": 15_170_323.28, "liabilities": 1_412_400.00, "nav": 13_757_923.28}
TOTALS_POST = {"assets": 15_170_323.28, "liabilities": 1_412_400.00, "nav": 13_757_923.28}

POLICY = {
    "policy_id": "steward-yield-usdc", "version": 4, "digest": POLICY_DIGEST, "uploaded_by": "risk.lead", "uploaded_at": "2026-09-09T16:02:00Z",
    "scope": {"chain_id": 1, "owned_accounts": [VAULT], "max_block_age_s": 3600, "archive_required": True,
              "boundary": ["every Morpho Blue supply and borrow position reachable from the vault or a nested vault", "look through ERC-4626 shares, LP tokens, and loop strategies to their underlying", "price tokens through their conversion chain down to a Chainlink feed or a policy par", "stop at off-chain reserves and at contracts with no adapter"]},
    "adapters": ["metamorpho_vault@1.0.0", "morpho_blue_market@1.0.0", "erc20_balance@1.0.0", "erc4626_generic@1.0.0", "morpho_loop_strategy@1.0.0", "curve_stable_lp@1.0.0", "pendle_pt@1.0.0", "morpho_urd_claimable@1.0.0", "chainlink_feed@1.0.0"],
    "pricing": [
        {"asset": "USDC", "source": "policy:par", "secondary": "—", "max_staleness_s": 0, "alert_bps": 0, "max_deviation_bps": 0, "haircut_bps": 0},
        {"asset": "USDe", "source": "chain:chainlink:USDe/USD", "secondary": "ext:coingecko:ethena-usde", "max_staleness_s": 3600, "alert_bps": 15, "max_deviation_bps": 25, "haircut_bps": 0},
        {"asset": "sUSDe", "source": "chain:erc4626:convertToAssets → USDe", "secondary": "ext:coingecko:ethena-staked-usde", "max_staleness_s": 3600, "alert_bps": 50, "max_deviation_bps": 100, "haircut_bps": 100},
        {"asset": "PT-sUSDe-27MAR2027", "source": "ext:pendle:twap:30m", "secondary": "ext:pendle:spot", "max_staleness_s": 1800, "alert_bps": 100, "max_deviation_bps": 200, "haircut_bps": 150},
        {"asset": "MORPHO", "source": "ext:coingecko:morpho", "secondary": "—", "max_staleness_s": 3600, "alert_bps": 0, "max_deviation_bps": 0, "haircut_bps": 5000},
        {"asset": "wstETH (collateral only)", "source": "not valued", "secondary": "—", "max_staleness_s": 0, "alert_bps": 0, "max_deviation_bps": 0, "haircut_bps": 0},
    ],
    "liabilities": ["morpho lending_debt at borrow shares converted up", "metamorpho accrued performance fee"],
    "manual_valuations": [{"contract": SPECTRA_LP, "kind": "lp_position", "value_base": "0", "attested_by": "risk.lead", "reason": "no adapter; immaterial; revisit when spectra_lp ships"}],
    "exclusions": [{"contract": USDE + " (reserves)", "reason": "off-chain custodian reserves are not chain-verifiable"}, {"contract": SPECTRA_LP, "reason": "awaiting adapter"}],
    "reconciliation": [
        {"id": "vault_total_assets", "scope": "vault", "posted_view": "metamorpho.total_assets", "tolerance_bps": 25, "severity": "critical"},
        {"id": "vault_last_total_assets", "scope": "vault", "posted_view": "metamorpho.last_total_assets", "tolerance_bps": 50, "severity": "info"},
        {"id": "market_shares", "scope": "per_node", "kind_filter": "lending_supply", "posted_view": "morpho_market.shares_to_assets", "tolerance_bps": 0, "severity": "warn"},
        {"id": "market_accrual", "scope": "per_node", "kind_filter": "lending_supply", "posted_view": "morpho_market.expected_supply_assets", "tolerance_bps": 25, "severity": "warn"},
        {"id": "nested_vault_conversion", "scope": "per_node", "kind_filter": "vault_share", "posted_view": "erc4626.convert_to_assets", "tolerance_bps": 25, "severity": "critical"},
        {"id": "collateral_conversion", "scope": "per_node", "kind_filter": "token_balance", "posted_view": "erc4626.convert_to_assets", "tolerance_bps": 110, "severity": "info"},
        {"id": "pt_rate", "scope": "per_node", "kind_filter": "pt_position", "posted_view": "pendle.pt_to_asset_rate", "tolerance_bps": 160, "severity": "info"},
        {"id": "lp_virtual_price", "scope": "per_node", "kind_filter": "lp_position", "posted_view": "curve.virtual_price_value", "tolerance_bps": 20, "severity": "info"},
    ],
    "post_state": {"risk_market_ids": ["USDC / PT-sUSDe-27MAR2027"], "max_residual_assets": "100,000 USDC", "conservation_bps": 5},
}

def transcript():
    T = []
    def u(t): T.append({"role": "user", "ts": "", "body": t})
    def a(t): T.append({"role": "assistant", "ts": "", "body": t})
    def tool(name, j, ts=""): T.append({"role": "tool", "name": name, "ts": ts, "json": j})
    def reads(n, target_hint):
        for sig in n:
            tool("nav-oracle pinned read", {"success": True, "result": "0x…", "result_keccak": h("k", target_hint, sig)[:22] + "…", "served_block": PIN})
    u(f"Activate nav-oracle/traversal. Open a valuation for {VAULT} on chain 1 under policy steward-yield-usdc v4, look through every nested position, then price, compile, and tell me where our NAV disagrees with what the vault posts.")
    tool("activate_skills", {"activated": ["nav-oracle/traversal"], "tokens": 812})
    tool("open_valuation", {"dag_id": "dag_vision_01", "phase": "pre", "pin": {"block_number": PIN, "block_hash": PIN_HASH}, "policy": {"policy_id": "steward-yield-usdc", "version": 4, "digest": POLICY_DIGEST}, "roots": [{"node_id": "n_root", "kind": "account", "adapter_id": "metamorpho_vault"}]})
    tool("expand_node", {"node_id": "n_root", "kind": "account", "adapter": "metamorpho_vault@1.0.0", "stage": 0, "reads": ["totalAssets()", "lastTotalAssets()", "asset()", "MORPHO()", "withdrawQueueLength()", "strategiesLength()"]})
    reads(["totalAssets()", "lastTotalAssets()", "asset()", "MORPHO()", "withdrawQueueLength()", "strategiesLength()"], VAULT)
    tool("write_to_dag", {"verdict": "stage_written", "node": {"node_id": "n_root", "stage": 1}, "posted_views": ["metamorpho.total_assets", "metamorpho.last_total_assets"]})
    tool("expand_node", {"node_id": "n_root", "stage": 1, "reads": ["withdrawQueue(0)", "withdrawQueue(1)", "strategies(0..4)", "balanceOf(vault) on USDC", "decimals()", "symbol()"]})
    reads(["withdrawQueue(uint256)", "withdrawQueue(uint256)", "strategies(uint256)", "strategies(uint256)", "strategies(uint256)", "strategies(uint256)", "strategies(uint256)", "balanceOf(address)", "decimals()", "symbol()"], VAULT)
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_root", "kind": "account"}, "children": ["n_idle", "n_mkt_wsteth", "n_mkt_ptsusde", "n_vs_prime", "n_vs_loop", "n_lp_curve", "n_pt_direct", "n_claim_rewards", "n_liab_fee", "n_lp_spectra"], "frontier_remaining": 10})
    a("Root verified. Ten children discovered: two Morpho markets, two nested vault positions, a Curve LP, a directly held PT, unclaimed rewards, an accrued fee liability, and one strategy with no adapter. Expanding one at a time.")
    tool("expand_node", {"node_id": "n_vs_prime", "kind": "vault_share", "adapter": "erc4626_generic@1.0.0", "stage": 0, "reads": ["asset()", "balanceOf(vault)"]})
    reads(["asset()", "balanceOf(address)"], PRIME)
    tool("write_to_dag", {"verdict": "stage_written", "node": {"node_id": "n_vs_prime", "stage": 1}})
    tool("expand_node", {"node_id": "n_vs_prime", "stage": 1, "reads": ["convertToAssets(shares)", "withdrawQueueLength()", "withdrawQueue(0)", "balanceOf(prime) on USDC"]})
    reads(["convertToAssets(uint256)", "withdrawQueueLength()", "withdrawQueue(uint256)", "balanceOf(address)"], PRIME)
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_vs_prime", "kind": "vault_share", "look_through": True}, "posted_views": ["erc4626.convert_to_assets"], "children": ["n_prime_mkt", "n_prime_idle"], "frontier_remaining": 11})
    tool("expand_node", {"node_id": "n_prime_mkt", "kind": "lending_supply", "adapter": "morpho_blue_market@1.0.0", "stage": 0, "reads": ["position(id, prime)", "market(id)", "idToMarketParams(id)"]})
    reads(["position(bytes32,address)", "market(bytes32)", "idToMarketParams(bytes32)"], "prime")
    tool("write_to_dag", {"verdict": "unresolved", "reason": "transport_digest_mismatch", "detail": "market(bytes32): host stamped 0x7bde…e1a4, relayed bytes hash to 0x1c02…9f77", "node": {"node_id": "n_prime_mkt", "attempts": 1}})
    a("The relayed `market(bytes32)` bytes did not hash to the host's stamp. Re-running that node's reads exactly.")
    tool("expand_node", {"node_id": "n_prime_mkt", "stage": 0, "attempt": 2, "reads": ["position(id, prime)", "market(id)", "idToMarketParams(id)"]})
    reads(["position(bytes32,address)", "market(bytes32)", "idToMarketParams(bytes32)"], "prime2")
    tool("write_to_dag", {"verdict": "stage_written", "node": {"node_id": "n_prime_mkt", "stage": 1, "attempts": 1}})
    tool("expand_node", {"node_id": "n_prime_mkt", "stage": 1, "reads": ["decimals() on loanToken", "symbol()", "borrowRateView(params, market) on IRM", "block timestamp"]})
    reads(["decimals()", "symbol()", "borrowRateView(...)", "get_time_and_onchain_context"], "prime3")
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_prime_mkt", "kind": "lending_supply", "quantity": "1,950,000.00 USDC"}, "posted_views": ["morpho_market.shares_to_assets", "morpho_market.expected_supply_assets"], "frontier_remaining": 10})
    tool("expand_node", {"node_id": "n_vs_loop", "kind": "vault_share", "adapter": "morpho_loop_strategy@1.0.0", "stage": 0, "reads": ["asset()", "balanceOf(vault)", "convertToAssets(shares)", "marketId()", "position(marketId, loop)", "market(marketId)"]})
    reads(["asset()", "balanceOf(address)", "convertToAssets(uint256)", "marketId()", "position(bytes32,address)", "market(bytes32)"], LOOP)
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_vs_loop", "kind": "vault_share", "look_through": True}, "children": ["n_loop_coll", "n_loop_debt"], "note": "collateral and debt written as separate nodes; debt carries relation owes", "frontier_remaining": 11})
    tool("expand_node", {"node_id": "n_loop_coll", "kind": "token_balance", "adapter": "erc4626_generic@1.0.0", "stage": 0, "reads": ["convertToAssets(1e18) on sUSDe", "asset() on sUSDe"]})
    reads(["convertToAssets(uint256)", "asset()"], SUSDE)
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_loop_coll", "quantity": "2,083,333.00 sUSDe"}, "children": ["n_price_susde"], "note": "sUSDe prices through USDe; a chain: price node is required by policy", "frontier_remaining": 11})
    tool("expand_node", {"node_id": "n_price_susde", "kind": "price", "stage": 0, "reads": ["convertToAssets(1e18)"]})
    reads(["convertToAssets(uint256)"], "susde-price")
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_price_susde", "kind": "price", "rate": "1.1760 USDe per sUSDe"}, "children": ["n_price_usde"], "frontier_remaining": 11})
    tool("expand_node", {"node_id": "n_price_usde", "kind": "price", "adapter": "chainlink_feed@1.0.0", "stage": 0, "reads": ["latestRoundData() on USDe/USD"]})
    reads(["latestRoundData()"], "usde-feed")
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_price_usde", "kind": "price", "answer": "0.99960000", "updated_at": "pin − 412 s"}, "children": ["n_usde_backing (excluded: off-chain custodian reserves)"], "frontier_remaining": 10})
    a("Pricing chain closed: sUSDe → USDe through the vault conversion, USDe → USD through Chainlink at the pin. The policy stops at USDe's reserves and records why. Continuing with the loop's debt, the LP, the PT, rewards, and the fee.")
    for nid, kind, adapter, rd in [("n_loop_debt", "lending_debt", "morpho_blue_market@1.0.0", ["position(bytes32,address)", "market(bytes32)"]),
                                   ("n_lp_curve", "lp_position", "curve_stable_lp@1.0.0", ["balanceOf(address)", "get_virtual_price()", "balances(uint256)", "balances(uint256)", "totalSupply()"]),
                                   ("n_pt_direct", "pt_position", "pendle_pt@1.0.0", ["balanceOf(address)", "expiry()", "SY()"]),
                                   ("n_claim_rewards", "claimable", "morpho_urd_claimable@1.0.0", ["claimed(address,address)"]),
                                   ("n_liab_fee", "liability", "metamorpho_vault@1.0.0", ["fee()", "lastTotalAssets()"]),
                                   ("n_mkt_wsteth", "lending_supply", "morpho_blue_market@1.0.0", ["position(bytes32,address)", "market(bytes32)", "idToMarketParams(bytes32)", "borrowRateView(...)"]),
                                   ("n_mkt_ptsusde", "lending_supply", "morpho_blue_market@1.0.0", ["position(bytes32,address)", "market(bytes32)", "idToMarketParams(bytes32)", "borrowRateView(...)"])]:
        tool("expand_node", {"node_id": nid, "kind": kind, "adapter": adapter, "stage": 0, "reads": rd})
        reads(rd, nid)
        tool("write_to_dag", {"verdict": "verified", "node": {"node_id": nid, "kind": kind}})
    tool("expand_node", {"node_id": "n_lp_spectra", "kind": "lp_position", "adapter": "spectra_lp"})
    tool("write_to_dag", {"verdict": "unresolved", "reason": "adapter_unknown", "node": {"node_id": "n_lp_spectra", "boundary": {"in_scope": False, "rule": "exclusions: no adapter for spectra_lp; manager attests < 0.1% of NAV"}}, "frontier_remaining": 0, "frontier_empty": True})
    a("Frontier empty. 20 nodes: 15 verified, 1 unresolved and out of scope by policy, 1 excluded boundary node, 2 price nodes, 1 liability. Activating accounting.")
    tool("activate_skills", {"activated": ["nav-oracle/accounting"], "deactivated": ["nav-oracle/traversal"]})
    tool("get_accounting_policy", {"policy_id": "steward-yield-usdc", "version": 4, "digest": POLICY_DIGEST, "pricing": 6, "reconciliation": 8, "exclusions": 2, "manual_valuations": 1})
    tool("price_nodes", {"priced": ["n_idle", "n_mkt_wsteth", "n_mkt_ptsusde", "n_prime_mkt", "n_prime_idle", "n_loop_coll", "n_loop_debt", "n_lp_usdc", "n_lp_usde", "n_pt_direct", "n_claim_rewards", "n_liab_fee"], "unpriced": [], "warnings": [{"node_id": "n_pt_direct", "kind": "price_deviation", "detail": "twap 0.9412 vs spot 0.9250 = 173 bps; alert 100, refuse 200; priced with 150 bps haircut"}]})
    tool("compile_nav", {"compiled": True, "report": {"totals": {"assets_base": "15,170,323.28", "liabilities_base": "1,412,400.00", "nav_base": "13,757,923.28"}, "checks": 13, "failed": 4}, "breaks": 6})
    a("NAV compiled: 13,757,923.28 USDC against a posted totalAssets of 13,843,461.00, a 62 bps gap, which is 85,538 USDC. Every dollar of it is attributed: 60,000 to the loop vault marking sUSDe at 1.20 where policy prices 1.176 with a haircut; 17,631 of unaccrued interest on the wstETH market; 12,500 to Prime's own oracle; 8,471 to the PT priced without a haircut; and −13,064 of MORPHO rewards the vault ignores. Two breaks are critical and open. Say the word and I will stage the PT-sUSDe exit and value the post-state.")
    u("Stage a full exit from the PT-sUSDe market into idle, bound residual exposure to 100,000 USDC, and value the post-state.")
    tool("activate_skills", {"activated": ["nav-oracle/postconditions"], "deactivated": ["nav-oracle/accounting"]})
    tool("stage_reallocation", {"pre_dag_id": "dag_vision_01", "market_ids": ["USDC/PT-sUSDe", "idle"], "signature": "reallocate(((address,address,address,address,uint256),uint256)[])", "calldata_keccak": h("calldata")[:22] + "…", "calldata_bytes": 452, "explicitly_absent": ["evm_commit_txs", "signature", "broadcast"]})
    tool("sim_open", {"sim": {"chain_id": 1, "block_number": PIN, "block_hash": PIN_HASH, "seq": 0}})
    tool("evm_stage_tx", {"pending_tx_id": "ptx_7c1e", "to": VAULT, "selector": "0x7299aa31", "data": {"encode": {"signature": "reallocate(...)", "args": ["[[…PT-sUSDe params…], 0], [[…idle params…], type(uint256).max]"]}}})
    tool("sim_apply", {"batch_success": True, "applied_ids": ["ptx_7c1e"], "steps": [{"id": "ptx_7c1e", "gas_used": 412_884, "logs": 7}], "sim": {"block_hash": PIN_HASH, "seq": 1}})
    tool("open_valuation", {"dag_id": "dag_vision_01_post", "phase": "post", "parent_dag_id": "dag_vision_01", "world": {"block_hash": PIN_HASH, "applied_ids": ["ptx_7c1e"], "seq": 1}, "plan": {"risk_market_ids": ["USDC/PT-sUSDe"], "max_residual_assets": "100,000.00"}})
    tool("expand_node", {"node_id": "n_mkt_ptsusde", "phase": "post", "reads": ["sim_call position(id, vault)", "sim_call market(id)"]})
    for sig in ["position(bytes32,address)", "market(bytes32)"]:
        tool("nav-oracle pinned read", {"success": True, "result": "0x…", "result_keccak": h("k", "post", sig)[:22] + "…", "sim": {"block_hash": PIN_HASH[:14] + "…", "seq": 1}})
    tool("write_to_dag", {"verdict": "verified", "node": {"node_id": "n_mkt_ptsusde", "quantity": "240,000.00 USDC", "note": "market liquidity capped the withdrawal at 2,960,000"}})
    tool("compile_nav", {"compiled": True, "report": {"phase": "post", "totals": {"nav_base": "13,757,923.28"}, "checks": 3, "failed": 2}, "breaks": 1})
    a("Post-state verdict: the reallocation would leave 240,000 USDC in the PT-sUSDe market because only 2,960,000 could be withdrawn at this block. That exceeds the 100,000 bound, so this is not an approvable package yet. NAV is conserved to the cent. A second tranche after liquidity returns, or a lower target, clears it. No transaction was committed, signed, or broadcast.")
    return T

TEMPLATE = open(__file__.replace("build-nav-vision.py", "nav-vision-template.html"), encoding="utf-8").read()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); args = ap.parse_args()
    data = {
        "vault": {"address": VAULT, "label": "Steward Yield USDC (illustrative)"},
        "pin": {"block_number": PIN, "block_hash": PIN_HASH},
        "policy": POLICY,
        "pre": {"dag_id": "dag_vision_01", "nodes": pre_nodes(), "edges": [{"parent": a, "child": b, "relation": r} for a, b, r in PRE_EDGES], "checks": PRE_CHECKS, "breaks": PRE_BREAKS, "totals": TOTALS_PRE},
        "post": {"dag_id": "dag_vision_01_post", "nodes": post_nodes(), "edges": [{"parent": a, "child": b, "relation": r} for a, b, r in PRE_EDGES], "checks": POST_CHECKS, "breaks": POST_BREAKS, "totals": TOTALS_POST,
                 "world": {"block_hash": PIN_HASH, "applied_ids": ["ptx_7c1e"], "seq": 1}, "plan": {"risk_market_ids": ["USDC / PT-sUSDe-27MAR2027"], "max_residual_assets": 100_000.00}},
        "transcript": transcript(),
    }
    page = TEMPLATE.replace("__DATA__", json.dumps(data).replace("</", "<\\/"))
    open(args.out, "w", encoding="utf-8").write(page)
    print(f"wrote {args.out}: {len(data['pre']['nodes'])} nodes, {len(data['transcript'])} transcript entries")

if __name__ == "__main__":
    main()
