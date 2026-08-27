import { describe, expect, it } from "vitest";
import {
  containmentAction,
  historicalContainmentAction,
  historicalMarkets,
  incidentFixtureSchema,
  safeBatch,
  summarizeIncident,
  transactionTimeline,
  usd0ppFixture,
} from "../src/index.js";
import { maxUint256 } from "viem";

describe("USD0++ incident reconstruction", () => {
  it("parses the checked-in public evidence fixture", () => {
    expect(incidentFixtureSchema.parse(usd0ppFixture()).events).toHaveLength(24);
  });

  it("pins the exact nine-transaction containment window", () => {
    const summary = summarizeIncident(usd0ppFixture());
    expect(summary.observedTransactions).toBe(9);
    expect(summary.riskInTransactions).toBe(0);
    expect(summary.riskOffTransactions).toBe(9);
    expect(summary.withdrawnFromRiskUsd).toBeCloseTo(36_571_906.861902, 6);
    expect(summary.suppliedToRiskUsd).toBe(0);
    expect(summary.discrepancy).toBeNull();
  });

  it("keeps the event order deterministic", () => {
    const timeline = transactionTimeline(usd0ppFixture());
    expect(timeline[0]?.hash).toBe("0xe9b338d19c1f412ff5a0db052dcb3d3ef2f91e613ab87e6fe7131d00263099ab");
    expect(timeline.at(-1)?.hash).toBe("0x7f56fc389026206ef5df0b72823b2c94efb1f26d0e542e4ac327c6899d9b018e");
  });
});

describe("containment artifact", () => {
  it("encodes one unsigned CALL for the historical vault", () => {
    const action = historicalContainmentAction();
    const batch = safeBatch([action]);
    expect(action.operation).toBe(0);
    expect(action.value).toBe("0");
    expect(action.data.length).toBeGreaterThan(10);
    expect(action.data.slice(0, 10)).toBe("0x7299aa31");
    expect(batch.transactions).toEqual([expect.objectContaining({ to: action.to, data: action.data })]);
  });

  it("uses the same generic encoder for manager-reviewed allocations", () => {
    const historical = historicalContainmentAction();
    const generic = containmentAction(historical.to, [
      { marketParams: historicalMarkets.usd0pp, assets: 0n },
      { marketParams: historicalMarkets.ptUsd0pp, assets: 0n },
      { marketParams: historicalMarkets.cbBtcDestination, assets: maxUint256 },
    ], historical.description);
    expect(generic.data).toBe(historical.data);
  });

  it("rejects delegatecall operations", () => {
    const action = { ...historicalContainmentAction(), operation: 1 as 0 };
    expect(() => safeBatch([action])).toThrow("Only CALL operations");
  });
});
