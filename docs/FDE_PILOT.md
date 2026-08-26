# Gauntlet FDE pilot brief

## One-line sell

**Your automation acts; Risk-Off proves that the right authority executed the intended containment and that the residual exposure actually crossed your completion threshold.**

## Demo script

1. Open the USD0++ replay and state the public claim.
2. Show nine observed reallocations, then reveal that two are risk-in and seven are risk-off.
3. Select a risk-off transaction and walk the event-level asset movements.
4. Verify its hash live. Show the outer signer, smart-account contract, allocator emitted by MetaMorpho, vault emitter, block match, and successful receipt.
5. Open the unsigned containment artifact. Point to the exact encoded call and the deliberate `executable: false` policy.
6. Export the evidence package.
7. Ask: “What internal artifact would let us reconcile the nine-call narrative and prove your actual completion condition?”

## Why Gauntlet should care

Gauntlet already has the optimizer, models, monitoring, rebalancing, and on-call operators. The uncovered product seam is independent post-decision assurance:

- model output versus operator interpretation;
- intended call versus Safe draft;
- Safe draft versus submitted transaction;
- transaction envelope versus inner allocator authority;
- emitted events versus claimed exposure reduction;
- final position versus an explicit residual-risk threshold.

This is narrower than a vault-management platform and easier to adopt: it can begin read-only, outside-in, and without signing authority.

## Pilot deliverables

- one adapter for a sanitized Gauntlet alert;
- one historical incident chosen by Gauntlet;
- one Safe proposal/receipt adapter;
- one residual-exposure policy definition;
- one operator evidence view;
- one machine-readable completion certificate.

## Commercial wedge

Charge for a scoped four-week incident replay and assurance integration, not a platform license. The expansion path is fleet coverage, continuous shadow verification, policy-regression testing, and an evidence API for vault partners, risk committees, and institutional allocators.
