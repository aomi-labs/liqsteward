# Gauntlet FDE pilot brief

## One-line sell

**Keep your models and manager authority. Aomi turns a risk signal into policy-checked alternatives, fork-simulates the selected response, and returns an unsigned Safe approval package.**

## Demo script

1. Run `inspect_vault` and show the exact RPC block, indexer block, roles, queues, caps, pending changes, allocations, and immediately withdrawable liquidity.
2. Run `get_pilot_policy`. Separate deterministic constraints from assumptions awaiting Gauntlet confirmation.
3. Submit a risk signal to `plan_reallocation` and compare full exit, 15%-limited tranche, and no-change alternatives.
4. Select an admissible plan and run `simulate_plan`.
5. Show the actual Aomi route: `evm_stage_tx → simulate_batch (stop on failure) → finalize_simulation`.
6. Inspect the unsigned Safe Transaction Builder package and prove that the simulated calldata is byte-identical to the proposal.
7. Open the USD0++ replay and verify one of the exact nine containment hashes live.
8. Ask: “Give us one sanitized alert and your real policy/approval topology. Can we cut alert-to-Safe-ready time without taking over your models or signing authority?”

## Why Gauntlet should care

Gauntlet already has the optimizer, models, monitoring, rebalancing, and on-call operators. The uncovered product seam is independent post-decision assurance:

- model output versus operator interpretation;
- intended call versus Safe draft;
- Safe draft versus submitted transaction;
- transaction envelope versus inner allocator authority;
- emitted events versus claimed exposure reduction;
- final position versus an explicit residual-risk threshold.

This is narrower than a vault-management platform and easier to adopt: it begins read-only and outside-in, then adds planning, fork simulation, and approval packaging without taking custody or bypassing the wallet policy.

## Pilot deliverables

- one adapter for a sanitized Gauntlet alert;
- one historical incident chosen by Gauntlet;
- one manager-approved target-allocation adapter;
- one Aomi `evm-core` stage/simulate route with no commit capability;
- one residual-exposure policy definition;
- one unsigned Safe approval package;
- one operator evidence view;
- one machine-readable completion certificate.

## Production gates

- Gauntlet confirms the market allowlist, safe-idle destination, cap/allocation constraints, and residual threshold.
- Gauntlet confirms whether the curator Safe or a dedicated allocator Safe is the approval route.
- Aomi `simulate_batch` gains generic post-call assertions so the same ephemeral fork directly proves resulting Morpho positions, caps, and withdrawable liquidity.
- RPC access moves from public best-effort endpoints to an authenticated provider with archive guarantees and an explicit latency/error budget.

## Commercial wedge

Charge for a scoped four-week forward-deployed integration, not a platform license. Week one reproduces a chosen incident outside-in; week two maps one sanitized manager alert into reviewed target allocations; week three proves the Aomi route in an authorized fork/test environment; week four measures time-to-simulated-proposal and residual-risk verification. The expansion path is fleet coverage, continuous shadow verification, policy-regression testing, and an evidence API for vault partners, risk committees, and institutional allocators.
