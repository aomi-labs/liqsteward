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
    expect(incidentFixtureSchema.parse(usd0ppFixture()).events).toHaveLength(27);
  });

  it("separates observed risk-in from risk-off transactions", () => {
    const summary = summarizeIncident(usd0ppFixture());
    expect(summary.observedTransactions).toBe(9);
    expect(summary.riskInTransactions).toBe(2);
    expect(summary.riskOffTransactions).toBe(7);
    expect(summary.withdrawnFromRiskUsd).toBeCloseTo(31_480_165.563993, 6);
    expect(summary.suppliedToRiskUsd).toBeCloseTo(6_438_548.881816, 6);
    expect(summary.discrepancy?.severity).toBe("material");
  });

  it("keeps the event order deterministic", () => {
    const timeline = transactionTimeline(usd0ppFixture());
    expect(timeline[0]?.hash).toBe("0x21f4353fda9ca215011336762e764b72ee5dd2c9821d15cce5499a9b5ea2d516");
    expect(timeline.at(-1)?.hash).toBe("0xd039e0a88e77fa798e5838273892da7c2c7b0f06883eeb43a847736097cb7146");
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
