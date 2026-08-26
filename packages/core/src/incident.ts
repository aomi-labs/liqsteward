import type { IncidentFixture, Reallocation } from "./types.js";

const USD0PP_MARKET = "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2";
const PT_USD0PP_MARKET = "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad";

export const RISK_MARKET_IDS = new Set([USD0PP_MARKET, PT_USD0PP_MARKET]);

const amount = (raw: string, decimals: number) => Number(BigInt(raw)) / 10 ** decimals;

export type IncidentTransaction = {
  hash: string;
  timestamp: number;
  blockNumber: number;
  caller: string;
  events: Reallocation[];
  suppliedToRiskUsd: number;
  withdrawnFromRiskUsd: number;
  netRiskDeltaUsd: number;
  classification: "risk-in" | "risk-off" | "mixed";
};

export function transactionTimeline(fixture: IncidentFixture): IncidentTransaction[] {
  const grouped = new Map<string, Reallocation[]>();
  for (const event of fixture.events) {
    grouped.set(event.hash, [...(grouped.get(event.hash) ?? []), event]);
  }

  return [...grouped.entries()]
    .map(([hash, events]) => {
      const suppliedToRiskUsd = events
        .filter((event) => event.type === "MarketSupply" && RISK_MARKET_IDS.has(event.market.id))
        .reduce((sum, event) => sum + amount(event.assets, fixture.vault.asset.decimals), 0);
      const withdrawnFromRiskUsd = events
        .filter((event) => event.type === "MarketWithdraw" && RISK_MARKET_IDS.has(event.market.id))
        .reduce((sum, event) => sum + amount(event.assets, fixture.vault.asset.decimals), 0);
      const netRiskDeltaUsd = suppliedToRiskUsd - withdrawnFromRiskUsd;
      const classification: IncidentTransaction["classification"] = suppliedToRiskUsd > 0 && withdrawnFromRiskUsd > 0
        ? "mixed"
        : netRiskDeltaUsd > 0
          ? "risk-in"
          : "risk-off";
      const first = events[0]!;
      return {
        hash,
        timestamp: first.timestamp,
        blockNumber: first.blockNumber,
        caller: first.caller,
        events,
        suppliedToRiskUsd,
        withdrawnFromRiskUsd,
        netRiskDeltaUsd,
        classification,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function summarizeIncident(fixture: IncidentFixture) {
  const timeline = transactionTimeline(fixture);
  const suppliedToRiskUsd = timeline.reduce((sum, tx) => sum + tx.suppliedToRiskUsd, 0);
  const withdrawnFromRiskUsd = timeline.reduce((sum, tx) => sum + tx.withdrawnFromRiskUsd, 0);
  const riskOffTransactions = timeline.filter((tx) => tx.classification === "risk-off").length;
  const riskInTransactions = timeline.filter((tx) => tx.classification === "risk-in").length;

  return {
    observedTransactions: timeline.length,
    riskOffTransactions,
    riskInTransactions,
    mixedTransactions: timeline.length - riskOffTransactions - riskInTransactions,
    suppliedToRiskUsd,
    withdrawnFromRiskUsd,
    netRiskDeltaUsd: suppliedToRiskUsd - withdrawnFromRiskUsd,
    discrepancy: timeline.length === 9 && riskOffTransactions !== 9
      ? {
          severity: "material" as const,
          claim: "Nine transactions withdrew all exposure.",
          observation: `${timeline.length} Morpho reallocation transactions are visible in the incident window, but ${riskOffTransactions} classify as pure risk-off and ${riskInTransactions} initially add direct USD0++ exposure.`,
          interpretation: "The public claim may count a narrower execution window, Safe transactions, or a different action boundary. Operator confirmation is required before treating the count as reconciled.",
        }
      : null,
  };
}

export function buildEvidencePackage(fixture: IncidentFixture) {
  const summary = summarizeIncident(fixture);
  const timeline = transactionTimeline(fixture);
  return {
    schemaVersion: "risk-off-evidence/v1",
    generatedAt: new Date().toISOString(),
    incident: {
      id: fixture.id,
      title: fixture.title,
      chainId: fixture.chainId,
      vault: fixture.vault,
      window: fixture.window,
    },
    claims: [
      {
        id: "official-response",
        text: fixture.officialNarrative.text,
        status: fixture.officialNarrative.status,
        source: fixture.officialNarrative.source,
      },
      {
        id: "observed-reallocations",
        text: `${summary.observedTransactions} unique Morpho reallocation transactions were observed.`,
        status: "verified-chain",
        source: fixture.extraction.source,
      },
      {
        id: "observed-risk-withdrawal",
        text: `${summary.withdrawnFromRiskUsd.toFixed(6)} USDC was withdrawn from the two identified USD0++ risk markets.`,
        status: "derived",
        source: "sum(events[type=MarketWithdraw, market in affectedMarketIds])",
      },
    ],
    summary,
    timeline,
    sourceManifest: [
      { kind: "official", url: fixture.officialNarrative.source },
      { kind: "chain-index", url: fixture.extraction.source, extractedAt: fixture.extraction.extractedAt },
    ],
  };
}
