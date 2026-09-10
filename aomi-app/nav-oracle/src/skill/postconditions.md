# Postconditions: value the simulated post-state

## Goal
Apply a proposed reallocation in a session simulation world pinned to the same block as the pre-state DAG, then build and compile a second DAG from the post-state so residual exposure is a measured fact, not an estimate.

## Steps
1. Start from a compiled pre-state DAG. Note its `pin.block_number` and `pin.block_hash`.
2. `sim_open { chain_ids: [1], block: "<pin.block_number>" }`. The world must report the same `block_hash` as the pin. If it does not, close it and report; never value a post-state on a different block.
3. `stage_reallocation { dag_id, allocations }` with explicit `{loan_token, collateral_token, oracle, irm, lltv, assets}` entries. It returns a route that stages the call through `evm_stage_tx` with structured encode args. Follow it exactly.
4. `sim_apply { transactions: [{ id: "<pending_tx_id from the stage result>", kind: "vault_reallocation", label: "..." }] }`. Copy the id verbatim. If `batch_success` is false, stop and report `halted_at_step`.
5. `open_valuation { vault, chain_id, block: "<pin.block_number>", phase: "post", parent_dag_id }`. Then traverse exactly as in `nav-oracle/traversal`, except every read goes through `sim_call` instead of `encode_and_call` so it observes the applied transaction. Each result carries the world's `sim` stamp; copy `block_hash`, `seq`, and `result_keccak` verbatim.
6. `compile_nav { dag_id }` on the post DAG. Residual-exposure breaks compare each risk market's post-state supply against the plan's bound.
7. `sim_close`.

## Rules
- The only transaction you stage is the one `stage_reallocation` authored. Do not stage anything else in this world.
- Pre and post DAGs must share `block_hash`. The server refuses post writes otherwise.
- No commit, no signature, no broadcast. A passing post-state is a report for the manager, not an execution.
