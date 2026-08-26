import { encodeFunctionData, maxUint256, type Address } from "viem";
import type { UnsignedAction } from "./types.js";

type MarketParams = {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const MORPHO_IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as const;

export const historicalMarkets = {
  usd0pp: {
    loanToken: USDC,
    collateralToken: "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
    oracle: "0x1325Eb089Ac14B437E78D5D481e32611F6907eF8",
    irm: MORPHO_IRM,
    lltv: 860000000000000000n,
  },
  ptUsd0pp: {
    loanToken: USDC,
    collateralToken: "0x5BaE9a5D67d1CA5b09B14c91935f635CFBF3b685",
    oracle: "0xE316c92D2B1f50a53E72461856fD50b2519e5800",
    irm: MORPHO_IRM,
    lltv: 915000000000000000n,
  },
  cbBtcDestination: {
    loanToken: USDC,
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    oracle: "0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a",
    irm: MORPHO_IRM,
    lltv: 860000000000000000n,
  },
} satisfies Record<string, MarketParams>;

const reallocateAbi = [{
  type: "function",
  name: "reallocate",
  stateMutability: "nonpayable",
  inputs: [{
    name: "allocations",
    type: "tuple[]",
    components: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
    ],
  }],
  outputs: [],
}] as const;

export function historicalContainmentAction(
  vault: Address = "0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458",
): UnsignedAction {
  const allocations = [
    { marketParams: historicalMarkets.usd0pp, assets: 0n },
    { marketParams: historicalMarkets.ptUsd0pp, assets: 0n },
    { marketParams: historicalMarkets.cbBtcDestination, assets: maxUint256 },
  ];
  return {
    to: vault,
    value: "0",
    operation: 0,
    data: encodeFunctionData({ abi: reallocateAbi, functionName: "reallocate", args: [allocations] }),
    description: "Set direct and PT USD0++ allocations to zero; route all withdrawn USDC to the observed cbBTC/USDC destination market.",
    status: "proposed",
  };
}

export function historicalContainmentPolicy() {
  return {
    mode: "counterfactual-reconstruction",
    executable: false,
    reason: "The incident is historical and the vault no longer carries the replayed state. The payload demonstrates exact encoding and approval shape; it must not be executed against current state.",
    constraints: [
      "No signing or submission",
      "Only two explicitly identified risk markets can be reduced",
      "Destination is restricted to a market observed in the historical response",
      "Allocator authorization and current-state fork simulation are required before any live proposal",
    ],
  };
}
