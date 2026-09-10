import { createHash } from "node:crypto";
import { hexToBytes, isHex, keccak256 } from "viem";
import type { Evidence, UnresolvedReason, ValuationDag } from "./types.js";

export const MAX_RAW_RESULT_CHARS = 1_000;

export type EvidenceVerdict = { ok: true } | { ok: false; reason: UnresolvedReason; detail: string };

/**
 * The server's own check of every relayed read. The plugin already did this;
 * doing it again here means a compromised or buggy plugin build cannot write
 * a quantity the bytes do not support.
 */
export function verifyEvidence(evidence: Evidence, dag: ValuationDag): EvidenceVerdict {
  if (evidence.raw_result.length > MAX_RAW_RESULT_CHARS) {
    return { ok: false, reason: "read_oversized", detail: `raw_result is ${evidence.raw_result.length} chars` };
  }
  if (!isHex(evidence.raw_result) || !isHex(evidence.result_keccak) || evidence.result_keccak.length !== 66) {
    return { ok: false, reason: "transport_invalid_hex", detail: `${evidence.function_signature}: raw_result or result_keccak is not hex` };
  }
  const actual = keccak256(hexToBytes(evidence.raw_result));
  if (actual.toLowerCase() !== evidence.result_keccak.toLowerCase()) {
    return {
      ok: false,
      reason: "transport_digest_mismatch",
      detail: `${evidence.function_signature}: host stamped ${evidence.result_keccak}, relayed bytes hash to ${actual}`,
    };
  }
  if (evidence.served_block !== dag.pin.block_number) {
    return {
      ok: false,
      reason: "served_block_mismatch",
      detail: `${evidence.function_signature}: served at ${evidence.served_block}, dag pinned at ${dag.pin.block_number}`,
    };
  }
  if (evidence.source === "evm_sim") {
    const expected = dag.world?.block_hash ?? dag.pin.block_hash;
    if (!evidence.block_hash || evidence.block_hash.toLowerCase() !== expected.toLowerCase()) {
      return {
        ok: false,
        reason: "world_hash_mismatch",
        detail: `${evidence.function_signature}: world block_hash ${evidence.block_hash ?? "missing"} != ${expected}`,
      };
    }
  } else if (dag.phase === "post") {
    return { ok: false, reason: "world_hash_mismatch", detail: `${evidence.function_signature}: post-phase reads must come from evm_sim` };
  }
  return { ok: true };
}

export function sha256Hex(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

export function nodeIdFor(parts: {
  chain_id: number;
  block_number: number;
  kind: string;
  contract: string;
  account: string;
  market_id?: string | null;
}): string {
  const key = [
    parts.chain_id,
    parts.block_number,
    parts.kind,
    parts.contract.toLowerCase(),
    parts.account.toLowerCase(),
    (parts.market_id ?? "").toLowerCase(),
  ].join(":");
  return `n_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}
