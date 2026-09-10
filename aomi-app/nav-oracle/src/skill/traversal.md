# Traversal: build the position DAG

## Goal
Turn the vault's owned accounts into a DAG of verified positions at one pinned block. Every node is backed by reads you relayed byte-for-byte.

## Steps
1. `open_valuation { vault, chain_id, policy_id?, block? }`. It pins block N, probes `totalAssets()` at N, mints `dag_id`, and returns the root `account` nodes. If the probe fails the block is unavailable to the host; report that and stop.
2. Call `expand_node { dag_id, node_id }` on the routed node. It returns a route: one `encode_and_call` step per read, each with `block_tag` set to N, ending in `write_to_dag`. Follow the route exactly. Do not add, merge, or skip reads.
3. When the route completes, call `write_to_dag` once for that node with every read's `function_signature`, `arguments`, `served_block`, `result_keccak`, and `raw_result` copied verbatim from the host results.
4. `write_to_dag` returns the node as `verified` or `unresolved` with a reason, plus `frontier_remaining` and exactly one routed `expand_node` for the next proposed node. Follow it. One node at a time: expand, read, write, then the next. Never expand a second node before the first is written; reads you have not written are lost when your turn ends.

## Rules
- Lost the next node id (for example after a resumed conversation)? Call `expand_node { dag_id }` with no `node_id`; it takes the next node from the server's frontier.
- Copy `raw_result` and `result_keccak` exactly as the host printed them. The app re-hashes the bytes; a single changed character makes the node `unresolved(transport_digest_mismatch)`.
- On `transport_digest_mismatch`, re-run only that node's route and write again. The server counts attempts; after the third failure the node stays unresolved and you move on.
- `served_block` must equal the pin. If a read came back at another block you forgot `block_tag`; re-run it.
- `unresolved(adapter_unknown)` means the contract shape has no adapter. Do not improvise a reading; leave it for the break queue.
- Never compute quantities yourself. `write_to_dag` decodes the bytes.
- One node per `write_to_dag`. Partial writes are refused.

## Done when
`write_to_dag` reports `frontier_empty: true`. Do not stop before that unless a node is unresolved after three attempts; report progress only when the frontier is empty or blocked. Then activate `nav-oracle/accounting`.
