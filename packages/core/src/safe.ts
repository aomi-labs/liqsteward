import type { SafeBatch, UnsignedAction } from "./types.js";

export function safeBatch(actions: UnsignedAction[], chainId = 1): SafeBatch {
  if (actions.some((action) => action.operation !== 0)) {
    throw new Error("Only CALL operations are accepted by this pilot");
  }
  return {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now().toString(),
    meta: {
      name: "Risk-Off Pilot — unsigned containment proposal",
      description: "Human approval required. Generated independently; not endorsed by Gauntlet.",
      source: "risk-off-pilot",
      txBuilderVersion: "1.18.0",
    },
    transactions: actions.map((action) => ({
      to: action.to,
      value: action.value,
      data: action.data,
      contractMethod: null,
      contractInputsValues: null,
    })),
  };
}
