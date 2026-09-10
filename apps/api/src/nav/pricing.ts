import { createHash } from "node:crypto";
import type { NavPolicy } from "./policy.js";
import { ASSET_KINDS, LIABILITY_KINDS, type DagNode, type PriceObservation, type Valuation, type ValuationDag } from "./types.js";

export interface PricingDeps {
  fetchImpl: typeof fetch;
  now: () => Date;
}

export type PriceOutcome =
  | { node_id: string; valuation: Valuation }
  | { node_id: string; reason: string };

function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function pricingKey(policy: NavPolicy, node: DagNode): string | null {
  const quantity = node.quantity;
  if (!quantity) return null;
  const byAddress = `${node.chain_id}:${quantity.asset.toLowerCase()}`;
  for (const key of Object.keys(policy.pricing)) {
    if (key.toLowerCase() === byAddress) return key;
  }
  if (policy.pricing[quantity.symbol]) return quantity.symbol;
  return null;
}

async function externalPrice(source: string, deps: PricingDeps): Promise<PriceObservation | { error: string }> {
  const [scheme, provider, ...rest] = source.split(":");
  if (scheme !== "ext") return { error: `unsupported price source scheme \`${scheme}\`` };
  if (provider === "coingecko") {
    const id = rest.join(":");
    if (!id) return { error: "ext:coingecko needs an asset id" };
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_last_updated_at=true`;
    const response = await deps.fetchImpl(url, { headers: { accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) return { error: `coingecko returned ${response.status}` };
    let payload: Record<string, { usd?: number; last_updated_at?: number }>;
    try {
      payload = JSON.parse(text);
    } catch {
      return { error: "coingecko returned non-JSON" };
    }
    const entry = payload[id];
    if (!entry || typeof entry.usd !== "number") return { error: `coingecko has no usd price for ${id}` };
    const fetchedAt = deps.now();
    const observedAt = entry.last_updated_at ? new Date(entry.last_updated_at * 1000) : fetchedAt;
    return {
      source,
      price: { raw: BigInt(Math.round(entry.usd * 1e8)).toString(), decimals: 8 },
      observed_at: observedAt.toISOString(),
      staleness_s: Math.max(0, Math.floor((fetchedAt.getTime() - observedAt.getTime()) / 1000)),
      provenance: { url, fetched_at: fetchedAt.toISOString(), response_sha256: `0x${createHash("sha256").update(text).digest("hex")}` },
    };
  }
  return { error: `unsupported external price provider \`${provider}\`` };
}

/**
 * Resolve a valuation for one verified node under the policy. Returns the
 * reason when no admissible price exists; the node then stays unpriced and
 * compile refuses.
 */
export async function priceNode(node: DagNode, dag: ValuationDag, policy: NavPolicy, deps: PricingDeps): Promise<PriceOutcome> {
  if (!node.quantity) return { node_id: node.node_id, reason: "node has no quantity" };
  if (!ASSET_KINDS.has(node.kind) && !LIABILITY_KINDS.has(node.kind)) {
    return { node_id: node.node_id, reason: `kind ${node.kind} is not valued` };
  }
  const manual = policy.manual_valuations.find((entry) => entry.contract.toLowerCase() === node.contract.toLowerCase() && entry.kind === node.kind);
  if (manual) {
    return {
      node_id: node.node_id,
      valuation: {
        status: "priced",
        policy_asset: "policy:manual",
        primary: { source: "policy:manual", price: { raw: "0", decimals: 0 }, staleness_s: 0 },
        haircut_bps: 0,
        value_base: manual.value_base,
        confidence: "manual",
        attested_by: manual.attested_by,
      },
    };
  }
  const key = pricingKey(policy, node);
  if (!key) return { node_id: node.node_id, reason: `no pricing rule for ${node.quantity.symbol} (${node.chain_id}:${node.quantity.asset})` };
  const rule = policy.pricing[key]!;
  const quantity = BigInt(node.quantity.raw);
  const base = dag.base_asset;
  if (!base) return { node_id: node.node_id, reason: "dag has no base asset yet (root not written)" };

  if (rule.source === "policy:par") {
    if (node.quantity.asset.toLowerCase() !== base.address.toLowerCase()) {
      return { node_id: node.node_id, reason: `policy:par only applies to the base asset; ${node.quantity.symbol} is not ${base.symbol}` };
    }
    const haircut = (quantity * BigInt(10_000 - rule.haircut_bps)) / 10_000n;
    return {
      node_id: node.node_id,
      valuation: {
        status: "priced",
        policy_asset: key,
        primary: { source: rule.source, price: { raw: "1", decimals: 0 }, observed_at_block: dag.pin.block_number, staleness_s: 0 },
        haircut_bps: rule.haircut_bps,
        value_base: haircut.toString(),
        confidence: "authoritative",
      },
    };
  }

  const primary = await externalPrice(rule.source, deps);
  if ("error" in primary) return { node_id: node.node_id, reason: primary.error };
  if (primary.staleness_s > rule.max_staleness_s) {
    return { node_id: node.node_id, reason: `${rule.source} is ${primary.staleness_s}s stale, policy allows ${rule.max_staleness_s}s` };
  }
  let secondary: PriceObservation | null = null;
  let deviationBps: number | null = null;
  if (rule.secondary) {
    const observed = await externalPrice(rule.secondary, deps);
    if ("error" in observed) return { node_id: node.node_id, reason: `secondary ${rule.secondary}: ${observed.error}` };
    secondary = observed;
    const p = BigInt(primary.price.raw);
    const s = BigInt(secondary.price.raw);
    deviationBps = p === 0n ? 10_000 : Number(((p > s ? p - s : s - p) * 10_000n) / p);
    if (deviationBps > rule.max_deviation_bps) {
      return { node_id: node.node_id, reason: `primary/secondary deviate ${deviationBps} bps, policy allows ${rule.max_deviation_bps}` };
    }
  }
  // value_usd = quantity × price, kept at 18 decimals.
  const valueUsd = (quantity * BigInt(primary.price.raw) * pow10(18)) / pow10(node.quantity.decimals + primary.price.decimals);
  // Base conversion: the base asset must itself be priced by policy. `policy:par`
  // for the base asset means one base unit is one USD.
  const baseRule = policy.pricing[base.symbol] ?? policy.pricing[`${dag.vault.chain_id}:${base.address.toLowerCase()}`];
  if (!baseRule || baseRule.source !== "policy:par") {
    return { node_id: node.node_id, reason: `cannot convert ${node.quantity.symbol} to ${base.symbol}: base asset must be priced policy:par in v1` };
  }
  const valueBaseRaw = (valueUsd * pow10(base.decimals)) / pow10(18);
  const haircut = (valueBaseRaw * BigInt(10_000 - rule.haircut_bps)) / 10_000n;
  return {
    node_id: node.node_id,
    valuation: {
      status: "priced",
      policy_asset: key,
      primary,
      secondary,
      deviation_bps: deviationBps,
      haircut_bps: rule.haircut_bps,
      value_base: haircut.toString(),
      value_usd: valueUsd.toString(),
      confidence: "reference",
    },
  };
}
