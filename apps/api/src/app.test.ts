import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("risk-off api", () => {
  it("serves the replay with a material reconciliation gap", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/incidents/usd0pp" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.observedTransactions).toBe(9);
    expect(body.summary.riskInTransactions).toBe(2);
    expect(body.summary.riskOffTransactions).toBe(7);
    expect(body.summary.discrepancy.severity).toBe("material");
    await app.close();
  });

  it("exports a non-executable Safe-shaped containment artifact", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/incidents/usd0pp/containment" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.policy.executable).toBe(false);
    expect(body.safeBatch.transactions).toHaveLength(1);
    expect(body.safeBatch.transactions[0].to.toLowerCase()).toBe("0x8eb67a509616cd6a7c1b3c8c21d48ff57df3d458");
    expect(body.safeBatch.transactions[0].data).toMatch(/^0x/);
    await app.close();
  });
});
