import { createHash } from "node:crypto";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex hash");
const decimalString = z.string().regex(/^\d+$/, "must be a non-negative integer string");

const nodeKind = z.enum([
  "account",
  "token_balance",
  "vault_share",
  "lending_supply",
  "lending_debt",
  "lp_position",
  "pt_position",
  "claimable",
  "liability",
  "price",
]);

export const navPolicySchema = z.object({
  schema: z.literal("liqsteward/nav-policy/v1"),
  policy_id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-_]*$/, "lowercase slug"),
  version: z.number().int().positive().optional(),
  digest: z.string().optional(),
  uploaded_by: z.string().min(1),
  uploaded_at: z.string().optional(),
  scope: z.object({
    chain_id: z.number().int().positive(),
    owned_accounts: z.array(address).min(1),
    boundary: z.array(
      z.union([
        z.object({ include: z.string().min(1) }),
        z.object({ exclude: z.string().min(1), reason: z.string().min(1) }),
      ]),
    ),
    max_block_age_s: z.number().int().positive(),
    archive_required: z.boolean(),
  }),
  adapters: z.array(
    z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      codehash: hash32.optional(),
      contract: address.optional(),
    }),
  ),
  pricing: z.record(
    z.string(),
    z.object({
      source: z.string().min(1),
      secondary: z.string().optional(),
      max_staleness_s: z.number().int().nonnegative(),
      max_deviation_bps: z.number().int().nonnegative(),
      haircut_bps: z.number().int().nonnegative().max(10_000),
    }),
  ),
  liabilities: z.array(z.string()),
  manual_valuations: z.array(
    z.object({
      contract: address,
      kind: nodeKind,
      value_base: decimalString,
      attested_by: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  exclusions: z.array(z.object({ contract: address, reason: z.string().min(1) })),
  reconciliation: z.array(
    z.object({
      id: z.string().min(1),
      scope: z.enum(["vault", "per_node"]),
      kind_filter: nodeKind.optional(),
      posted_view: z.string().min(1),
      tolerance_bps: z.number().int().nonnegative(),
      severity: z.enum(["info", "warn", "critical"]),
    }),
  ),
  tolerances: z.object({ total_assets_conservation_bps: z.number().int().nonnegative() }),
});

export type NavPolicy = z.infer<typeof navPolicySchema>;

export interface PostedViewSpec {
  id: string;
  adapter_id: string;
  scope: "vault" | "per_node";
  description: string;
}

/**
 * Posted views adapters declare. A policy may only select from this list;
 * the plugin's adapters emit the matching `posted_views` entries on writes.
 */
export const POSTED_VIEW_CATALOG: PostedViewSpec[] = [
  {
    id: "metamorpho.total_assets",
    adapter_id: "metamorpho_vault",
    scope: "vault",
    description: "The vault's own totalAssets() at the pinned block.",
  },
  {
    id: "metamorpho.last_total_assets",
    adapter_id: "metamorpho_vault",
    scope: "vault",
    description: "lastTotalAssets(): the vault's last accrual checkpoint.",
  },
  {
    id: "morpho_market.shares_to_assets",
    adapter_id: "morpho_blue_market",
    scope: "per_node",
    description: "Supply shares converted at the market's stored totals, without interest accrual.",
  },
  {
    id: "erc4626.convert_to_assets",
    adapter_id: "erc4626_generic",
    scope: "per_node",
    description: "convertToAssets(balance) as the vault itself reports it.",
  },
];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** sha256 over canonical JSON of the policy minus `digest`, `version`, `uploaded_at`. */
export function policyDigest(policy: Record<string, unknown>): string {
  const { digest: _digest, version: _version, uploaded_at: _at, ...rest } = policy;
  return `0x${createHash("sha256").update(JSON.stringify(canonical(rest))).digest("hex")}`;
}

export function validatePolicy(input: unknown): { ok: true; policy: NavPolicy } | { ok: false; error: string } {
  const parsed = navPolicySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join(".") || "policy"}: ${issue.message}` : "invalid policy" };
  }
  const policy = parsed.data;
  const catalog = new Set(POSTED_VIEW_CATALOG.map((view) => view.id));
  for (const check of policy.reconciliation) {
    if (!catalog.has(check.posted_view)) {
      return { ok: false, error: `reconciliation.${check.id}: posted_view \`${check.posted_view}\` is not in the catalog` };
    }
    const spec = POSTED_VIEW_CATALOG.find((view) => view.id === check.posted_view)!;
    if (spec.scope !== check.scope) {
      return { ok: false, error: `reconciliation.${check.id}: \`${check.posted_view}\` is a ${spec.scope} view` };
    }
  }
  const ids = new Set<string>();
  for (const check of policy.reconciliation) {
    if (ids.has(check.id)) return { ok: false, error: `reconciliation: duplicate check id \`${check.id}\`` };
    ids.add(check.id);
  }
  return { ok: true, policy };
}

/** The adapter the policy binds to a contract, if any. */
export function adapterFor(policy: NavPolicy, contract: string): { id: string; version: string } | null {
  const lower = contract.toLowerCase();
  const pinned = policy.adapters.find((adapter) => adapter.contract?.toLowerCase() === lower);
  return pinned ? { id: pinned.id, version: pinned.version } : null;
}

export function adapterVersion(policy: NavPolicy, adapterId: string): string | null {
  return policy.adapters.find((adapter) => adapter.id === adapterId)?.version ?? null;
}

export function exclusionFor(policy: NavPolicy, contract: string): string | null {
  const lower = contract.toLowerCase();
  return policy.exclusions.find((exclusion) => exclusion.contract.toLowerCase() === lower)?.reason ?? null;
}
