# Gauntlet FDE pilot brief

## One-line sell

**Keep your models and manager authority. Aomi turns the approved response into a simulated, wallet-approved execution route, then proves what landed and what risk remained.**

## Demo script

1. Open the USD0++ replay and state the public claim.
2. Show nine observed reallocations, then reveal that two are risk-in and seven are risk-off.
3. Select a risk-off transaction and walk the event-level asset movements.
4. Verify its hash live. Show the outer signer, smart-account contract, allocator emitted by MetaMorpho, vault emitter, block match, and successful receipt.
5. Open the execution-route explainer. Distinguish the historical `executable: false` preview from a current manager-approved action.
6. Show the actual Aomi route: `evm_stage_tx → simulate_batch (stop on failure) → evm_commit_txs (allocator wallet approval) → verify_execution`.
7. Export the evidence package.
8. Ask: “Give us one sanitized alert, your allocator approval policy, and a historical incident. Can we beat your current alert-to-simulated-proposal time without taking over model or signing authority?”

## Why Gauntlet should care

Gauntlet already has the optimizer, models, monitoring, rebalancing, and on-call operators. The uncovered product seam is independent post-decision assurance:

- model output versus operator interpretation;
- intended call versus Safe draft;
- Safe draft versus submitted transaction;
- transaction envelope versus inner allocator authority;
- emitted events versus claimed exposure reduction;
- final position versus an explicit residual-risk threshold.

This is narrower than a vault-management platform and easier to adopt: it begins read-only and outside-in, then adds a manager-authorized execution route without taking custody or bypassing the wallet approval policy.

## Pilot deliverables

- one adapter for a sanitized Gauntlet alert;
- one historical incident chosen by Gauntlet;
- one manager-approved target-allocation adapter;
- one Aomi `evm-core` stage/simulate/commit route;
- one residual-exposure policy definition;
- one operator evidence view;
- one machine-readable completion certificate.

## Commercial wedge

Charge for a scoped four-week forward-deployed integration, not a platform license. Week one reproduces a chosen incident outside-in; week two maps one sanitized manager alert into reviewed target allocations; week three proves the Aomi route in an authorized fork/test environment; week four measures time-to-simulated-proposal and residual-risk verification. The expansion path is fleet coverage, continuous shadow verification, policy-regression testing, and an evidence API for vault partners, risk committees, and institutional allocators.
