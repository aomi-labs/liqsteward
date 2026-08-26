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

  it("encodes reviewed allocations without staging or submitting them", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/containment/encode",
      payload: {
        chain_id: 1,
        vault: "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458",
        incident_id: "usd0pp-test",
        confirmed: true,
        allocations: [
          {
            market: {
              loan_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              collateral_token: "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
              oracle: "0x1325Eb089Ac14B437E78D5D481e32611F6907eF8",
              irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
              lltv: "860000000000000000",
            },
            assets: "0",
          },
          {
            market: {
              loan_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              collateral_token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
              oracle: "0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a",
              irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
              lltv: "860000000000000000",
            },
            assets: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      selector: "0x7299aa31",
      execution: expect.stringContaining("Aomi evm-core"),
    }));
    await app.close();
  });
});
