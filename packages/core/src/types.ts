import { z } from "zod";

export const evidenceStatusSchema = z.enum([
  "verified-chain",
  "official-claim",
  "derived",
  "operator-input",
  "unverified",
]);

export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const marketSchema = z.object({
  id: z.string(),
  label: z.string(),
  collateralSymbol: z.string(),
  collateralAddress: z.string(),
  loanSymbol: z.string(),
  lltv: z.string(),
});

export const reallocationSchema = z.object({
  id: z.string(),
  hash: z.string(),
  blockNumber: z.number().int(),
  timestamp: z.number().int(),
  caller: z.string(),
  type: z.enum(["MarketSupply", "MarketWithdraw"]),
  assets: z.string(),
  market: marketSchema,
});

export const incidentFixtureSchema = z.object({
  id: z.string(),
  title: z.string(),
  chainId: z.number().int(),
  vault: z.object({
    address: z.string(),
    nameAtReplay: z.string(),
    currentName: z.string(),
    asset: z.object({ symbol: z.string(), decimals: z.number().int() }),
  }),
  window: z.object({ from: z.string(), to: z.string() }),
  affectedMarketIds: z.array(z.string()),
  officialNarrative: z.object({
    text: z.string(),
    source: z.string().url(),
    status: evidenceStatusSchema,
  }),
  extraction: z.object({
    source: z.string().url(),
    query: z.string(),
    extractedAt: z.string(),
  }),
  events: z.array(reallocationSchema),
});

export type Market = z.infer<typeof marketSchema>;
export type Reallocation = z.infer<typeof reallocationSchema>;
export type IncidentFixture = z.infer<typeof incidentFixtureSchema>;

export type TransactionVerification = {
  hash: string;
  chainId: number;
  status: "confirmed" | "reverted" | "pending" | "not-found";
  from?: string;
  to?: string;
  blockNumber?: string;
  blockTimestamp?: string;
  inputSelector?: string;
  value?: string;
  receiptLogs?: number;
  authorityPath?: {
    envelopeSigner: string;
    executionContract: string;
    indexedAllocator?: string;
    vaultEventEmitter?: string;
  };
  assertions: Array<{
    label: string;
    passed: boolean;
    evidence: string;
  }>;
};

export type UnsignedAction = {
  to: string;
  value: "0";
  data: string;
  operation: 0;
  description: string;
  status: "historical-observed" | "proposed";
};

export type SafeBatch = {
  version: "1.0";
  chainId: string;
  createdAt: string;
  meta: {
    name: string;
    description: string;
    source: string;
    txBuilderVersion: string;
  };
  transactions: Array<{
    to: string;
    value: string;
    data: string;
    contractMethod: null;
    contractInputsValues: null;
  }>;
};
