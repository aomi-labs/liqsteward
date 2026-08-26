import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MORPHO_API_URL = process.env.MORPHO_API_URL ?? "https://api.morpho.org/graphql";
const VAULT = "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458";
const FROM = 1736452800;
const TO = 1736488800;

const query = `query IncidentReallocations {
  vaultReallocates(
    first: 1000
    orderBy: Timestamp
    orderDirection: Asc
    where: {
      vaultAddress_in: ["${VAULT}"]
      chainId_in: [1]
      timestamp_gte: ${FROM}
      timestamp_lte: ${TO}
    }
  ) {
    items {
      id
      timestamp
      hash
      blockNumber
      caller
      assets
      type
      market {
        marketId
        lltv
        collateralAsset { address symbol }
        loanAsset { address symbol }
      }
    }
  }
}`;

type ApiEvent = {
  id: string;
  timestamp: number;
  hash: string;
  blockNumber: number;
  caller: string;
  assets: number | string;
  type: "ReallocateSupply" | "ReallocateWithdraw";
  market: {
    marketId: string;
    lltv: string;
    collateralAsset: { address: string; symbol: string };
    loanAsset: { address: string; symbol: string };
  };
};

const response = await fetch(MORPHO_API_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw new Error(`Morpho API returned ${response.status}`);
const payload = await response.json() as {
  data?: { vaultReallocates?: { items: ApiEvent[] } };
  errors?: Array<{ message: string }>;
};
if (payload.errors?.length) throw new Error(payload.errors.map(({ message }) => message).join("; "));
const items = payload.data?.vaultReallocates?.items;
if (!items) throw new Error("Morpho API response did not include vaultReallocates.items");

const fixture = {
  id: "usd0pp-2025-01-09",
  title: "USD0++ depeg response — Gauntlet USDC Balanced",
  chainId: 1,
  vault: {
    address: VAULT,
    nameAtReplay: "Gauntlet USDC Balanced",
    currentName: "Gauntlet USDC Core",
    asset: { symbol: "USDC", decimals: 6 },
  },
  window: {
    from: new Date(FROM * 1000).toISOString(),
    to: new Date(TO * 1000).toISOString(),
  },
  affectedMarketIds: [
    "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2",
    "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad",
  ],
  officialNarrative: {
    text: "Nine transactions between January 9 at 9:46pm and January 10 at 4:02am withdrew all exposure from USD0++ markets without bad debt.",
    source: "https://vaultbook.gauntlet.xyz/resources/market-volatility",
    status: "official-claim",
  },
  extraction: {
    source: MORPHO_API_URL,
    query: query.replace(/\s+/g, " ").trim(),
    extractedAt: new Date().toISOString(),
  },
  events: items.map((event) => ({
    id: event.id,
    hash: event.hash,
    blockNumber: event.blockNumber,
    timestamp: event.timestamp,
    caller: event.caller,
    type: event.type === "ReallocateSupply" ? "MarketSupply" : "MarketWithdraw",
    assets: String(event.assets),
    market: {
      id: event.market.marketId,
      label: `${event.market.collateralAsset.symbol} / ${event.market.loanAsset.symbol}`,
      collateralSymbol: event.market.collateralAsset.symbol,
      collateralAddress: event.market.collateralAsset.address,
      loanSymbol: event.market.loanAsset.symbol,
      lltv: event.market.lltv,
    },
  })),
};

const output = resolve("packages/core/src/data/usd0pp-2025.json");
await writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`);
const transactions = new Set(items.map(({ hash }) => hash));
console.log(`Wrote ${items.length} events across ${transactions.size} transactions to ${output}`);
