# Accounting: price, reconcile, compile

## Goal
Value every verified node under the user's accounting policy and produce a NAV report whose every number traces to evidence, a policy digest, and the pinned block.

## Steps
1. `get_accounting_policy { vault, policy_id?, version? }`. Read `pricing`, `reconciliation`, `manual_valuations`, `exclusions`, and `tolerances`. The DAG was opened against a specific policy version; use that one.
2. For `chain:` price sources in the policy (for example a Chainlink feed), route the read the policy names through `encode_and_call` at the pinned block and write it as a `price` node with `write_to_dag`, exactly as in traversal.
3. `price_nodes { dag_id, node_ids }` for every verified leaf. The server resolves `ext:` sources itself and applies staleness, deviation, and haircut rules. It returns `unpriced[]` with reasons; a node with no admissible price stays unpriced.
4. For each reconciliation check the policy selects, `expand_node` with the check's `posted_view` so the posted value is a verified node too.
5. `compile_nav { dag_id }`. It folds quantities and prices in the vault's base asset, runs the selected checks, and either returns the report summary with `breaks[]` or refuses and lists the blocking nodes.

## Rules
- Denomination is the vault's base asset. USD is an overlay the policy may add; it never drives a check.
- You do not choose price sources, tolerances, or exclusions. The policy does. If the policy is silent on an asset, the node stays unpriced and becomes a break.
- Manual valuations come from the policy with an attester. Never apply one that is not in the policy.
- `compile_nav` refuses while any in-scope node is `proposed` or `unresolved`, any leaf is unpriced, or the pin is older than the policy allows. Fix the cause or report the refusal; do not re-pin to make it pass.
- Report breaks as breaks. Do not reconcile a difference by explanation in prose.

## Done when
`compile_nav` returns a report. Offer `export_nav_report { dag_id }` for the evidence bundle.
