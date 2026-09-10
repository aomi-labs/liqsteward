import { describe, expect, it } from "vitest";
import { hexToBytes, keccak256 } from "viem";
import { compileDag } from "./compile.js";
import pilot from "./fixtures/pilot-policy.json" with { type: "json" };
import { POSTED_VIEW_CATALOG, policyDigest, validatePolicy } from "./policy.js";
import type { DagNode, Evidence, ValuationDag } from "./types.js";
import { nodeIdFor, verifyEvidence } from "./verify.js";

const VAULT = "0x8eb67a509616cd6a7c1b3c8c21d48ff57df3d458";
const HASH = "0x" + "ab".repeat(32);

function dag(overrides: Partial<ValuationDag> = {}): ValuationDag {
  return {
    dag_id: "dag_test",
    aomi_session_id: "sess",
    vault: { chain_id: 1, address: VAULT, label: "pilot" },
    pin: { block_number: 100, block_hash: HASH, pinned_at: new Date().toISOString() },
    policy: { policy_id: "gauntlet-usdc-core-pilot", version: 1, digest: "0x00" },
    phase: "pre",
    status: "open",
    root_node_ids: ["n_root"],
    base_asset: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function evidence(raw: string, overrides: Partial<Evidence> = {}): Evidence {
  return {
    source: "evm_reads",
    target: VAULT,
    function_signature: "totalAssets()",
    arguments: [],
    served_block: 100,
    result_keccak: keccak256(hexToBytes(raw as `0x${string}`)),
    raw_result: raw,
    decoded_by: "metamorpho_vault@1.0.0",
    ...overrides,
  };
}

function node(overrides: Partial<DagNode>): DagNode {
  return {
    node_id: "n_x",
    dag_id: "dag_test",
    kind: "lending_supply",
    status: "priced",
    chain_id: 1,
    contract: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    account: VAULT,
    semantic: { protocol: "morpho", adapter_id: "morpho_blue_market", adapter_version: "1.0.0" },
    boundary: { in_scope: true, rule: "test" },
    evidence: [],
    posted_views: [],
    child_hints: [],
    stage: 1,
    attempts: 0,
    discovered_by: "adapter",
    written_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("policy", () => {
  it("accepts the pilot fixture and digests it deterministically", () => {
    const parsed = validatePolicy(pilot);
    expect(parsed.ok).toBe(true);
    const a = policyDigest(pilot as Record<string, unknown>);
    const b = policyDigest({ ...pilot, version: 9, digest: "0xdead", uploaded_at: "later" } as Record<string, unknown>);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    const reordered = Object.fromEntries(Object.keys(pilot).sort().reverse().map((key) => [key, (pilot as Record<string, unknown>)[key]]));
    expect(policyDigest(reordered)).toBe(a);
  });

  it("rejects posted views outside the catalog and scope mismatches", () => {
    const bad = { ...pilot, reconciliation: [{ id: "x", scope: "vault", posted_view: "nope.view", tolerance_bps: 1, severity: "info" }] };
    expect(validatePolicy(bad)).toMatchObject({ ok: false });
    const wrongScope = { ...pilot, reconciliation: [{ id: "x", scope: "per_node", posted_view: "metamorpho.total_assets", tolerance_bps: 1, severity: "info" }] };
    expect(validatePolicy(wrongScope)).toMatchObject({ ok: false });
    expect(POSTED_VIEW_CATALOG.map((view) => view.id)).toContain("metamorpho.total_assets");
  });
});

describe("evidence verification", () => {
  const word = "0x" + "00".repeat(31) + "2a";

  it("accepts faithfully relayed bytes at the pinned block", () => {
    expect(verifyEvidence(evidence(word), dag())).toEqual({ ok: true });
  });

  it("flags a retyped nibble, a wrong block, and a post-phase read from evm_reads", () => {
    const corrupted = evidence(word, { raw_result: word.replace("2a", "2b") });
    expect(verifyEvidence(corrupted, dag())).toMatchObject({ ok: false, reason: "transport_digest_mismatch" });
    expect(verifyEvidence(evidence(word, { served_block: 99 }), dag())).toMatchObject({ ok: false, reason: "served_block_mismatch" });
    expect(verifyEvidence(evidence(word), dag({ phase: "post", world: { block_hash: HASH, applied_ids: ["t1"], seq: 1 } }))).toMatchObject({ ok: false, reason: "world_hash_mismatch" });
    const sim = evidence(word, { source: "evm_sim", block_hash: HASH, seq: 1 });
    expect(verifyEvidence(sim, dag({ phase: "post", world: { block_hash: HASH, applied_ids: ["t1"], seq: 1 } }))).toEqual({ ok: true });
  });

  it("derives deterministic node ids that separate markets on the same contract", () => {
    const a = nodeIdFor({ chain_id: 1, block_number: 100, kind: "lending_supply", contract: "0xAB", account: "0xCD", market_id: "0x01" });
    const b = nodeIdFor({ chain_id: 1, block_number: 100, kind: "lending_supply", contract: "0xab", account: "0xcd", market_id: "0x01" });
    const c = nodeIdFor({ chain_id: 1, block_number: 100, kind: "lending_supply", contract: "0xab", account: "0xcd", market_id: "0x02" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^n_[0-9a-f]{12}$/);
  });
});

describe("compile", () => {
  const policy = (() => {
    const parsed = validatePolicy(pilot);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.policy;
  })();
  const now = new Date();

  const root = node({
    node_id: "n_root",
    kind: "account",
    status: "verified",
    contract: VAULT,
    posted_views: [
      { view_id: "metamorpho.total_assets", value_raw: "1000000000", evidence_index: 0 },
      { view_id: "metamorpho.last_total_assets", value_raw: "999000000", evidence_index: 1 },
    ],
  });
  const priced = (id: string, raw: string, marketId: string) =>
    node({
      node_id: id,
      market_id: marketId,
      quantity: { raw, decimals: 6, symbol: "USDC", asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
      posted_views: [{ view_id: "morpho_market.shares_to_assets", value_raw: raw, evidence_index: 0 }],
      valuation: {
        status: "priced",
        policy_asset: "USDC",
        primary: { source: "policy:par", price: { raw: "1", decimals: 0 }, staleness_s: 0 },
        haircut_bps: 0,
        value_base: raw,
        confidence: "authoritative",
      },
    });

  it("refuses while any in-scope node is proposed or unresolved", () => {
    const outcome = compileDag(dag(), [root, node({ node_id: "n_p", status: "proposed" })], policy, now);
    expect(outcome).toMatchObject({ ok: false, refused: "in-scope nodes are not verified" });
  });

  it("refuses unpriced leaves", () => {
    const outcome = compileDag(dag(), [root, node({ node_id: "n_v", status: "verified", quantity: { raw: "1", decimals: 6, symbol: "USDC", asset: "0x" } })], policy, now);
    expect(outcome).toMatchObject({ ok: false, refused: "leaves are unpriced" });
  });

  it("folds positions, runs the selected checks, and opens breaks on failure", () => {
    const nodes = [root, priced("n_a", "600000000", "0x01"), priced("n_b", "399800000", "0x02")];
    const outcome = compileDag(dag(), nodes, policy, now);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.totals.nav_base).toBe("999800000");
    const vaultCheck = outcome.report.checks.find((check) => check.id === "vault_total_assets")!;
    expect(vaultCheck.verdict).toBe("pass");
    expect(vaultCheck.delta_bps).toBe(2);
    expect(outcome.report.checks.filter((check) => check.scope === "per_node")).toHaveLength(2);
    expect(outcome.breaks).toHaveLength(0);

    const drifted = [root, priced("n_a", "600000000", "0x01"), priced("n_b", "300000000", "0x02")];
    const failed = compileDag(dag(), drifted, policy, now);
    if (!failed.ok) throw new Error(failed.refused);
    expect(failed.report.checks.find((check) => check.id === "vault_total_assets")!.verdict).toBe("fail");
    // A 10 % drift trips both vault-level checks; per-node views still agree.
    expect(failed.breaks.map((item) => [item.kind, item.check_id, item.severity])).toEqual([
      ["reconciliation", "vault_total_assets", "critical"],
      ["reconciliation", "vault_last_total_assets", "info"],
    ]);
  });

  it("measures residual exposure on a post-phase dag against the plan bound", () => {
    const post = dag({ phase: "post", world: { block_hash: HASH, applied_ids: ["t1"], seq: 1 }, plan: { risk_market_ids: ["0x02"], max_residual_assets: "1000" } });
    const nodes = [root, priced("n_a", "999000000", "0x01"), priced("n_b", "1000000", "0x02")];
    const outcome = compileDag(post, nodes, policy, now);
    if (!outcome.ok) throw new Error(outcome.refused);
    const residual = outcome.report.checks.find((check) => check.id === "residual_exposure")!;
    expect(residual.verdict).toBe("fail");
    expect(residual.observed).toBe("1000000");
    expect(outcome.breaks.some((item) => item.kind === "residual_exposure")).toBe(true);
  });

  it("refuses a stale pin", () => {
    const stale = dag({ pin: { block_number: 100, block_hash: HASH, pinned_at: new Date(now.getTime() - 7200_000).toISOString() } });
    expect(compileDag(stale, [root, priced("n_a", "1000000000", "0x01")], policy, now)).toMatchObject({ ok: false });
  });
});
